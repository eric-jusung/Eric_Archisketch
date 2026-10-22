#!/usr/bin/env bash
# Publish this repository to https://archisketch.co.jp on AWS.
# Requires the AWS CLI, signed in to the account that owns the
# archisketch.co.jp Route 53 hosted zone.
#
#   aws sts get-caller-identity
#   ./infra/deploy.sh
#
# The stack is created in us-east-1 because CloudFront certificates
# must live there. After the files are uploaded, DNS for the apex and
# www names is switched from Netlify to this CloudFront distribution.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="us-east-1"
DOMAIN="archisketch.co.jp"
STACK="archisketch-co-jp"
CLOUDFRONT_ZONE="Z2FDTNDATAQYW2"

if ! command -v aws >/dev/null 2>&1; then
  echo "Install the AWS CLI and sign in to the archisketch.co.jp account first." >&2
  exit 1
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account: $ACCOUNT"
echo "Region:  $REGION"

ZONE_ID="$(aws route53 list-hosted-zones-by-name \
  --dns-name "$DOMAIN" \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" \
  --output text)"
ZONE_ID="${ZONE_ID#/hostedzone/}"
if [[ -z "$ZONE_ID" || "$ZONE_ID" == "None" ]]; then
  echo "No Route 53 hosted zone named ${DOMAIN} in this account." >&2
  exit 1
fi
echo "Hosted zone: $ZONE_ID"

echo "Creating the bucket, certificate, and CloudFront distribution."
echo "Certificate approval uses the hosted zone and can take several minutes."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file "$ROOT/infra/cloudformation.yml" \
  --parameter-overrides "DomainName=${DOMAIN}" "HostedZoneId=${ZONE_ID}" \
  --no-fail-on-empty-changeset

BUCKET="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"
DISTRIBUTION_DOMAIN="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" \
  --output text)"

echo "Uploading the site to s3://${BUCKET}"
aws s3 sync "$ROOT" "s3://${BUCKET}" \
  --region "$REGION" \
  --delete \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude "infra/*" \
  --exclude "netlify.toml" \
  --cache-control "public, max-age=3600"

echo "Refreshing CloudFront ${DISTRIBUTION_ID}"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" >/dev/null

python3 - "$ZONE_ID" "$DOMAIN" "$DISTRIBUTION_DOMAIN" "$CLOUDFRONT_ZONE" <<'PY'
import json, sys, subprocess
zone_id, domain, target, cf_zone = sys.argv[1:]
target = target.rstrip(".") + "."
apex = domain + "."
www = "www." + apex

existing = json.loads(subprocess.check_output([
    "aws", "route53", "list-resource-record-sets",
    "--hosted-zone-id", zone_id,
    "--output", "json",
]))
by_key = {(r["Name"], r["Type"]): r for r in existing["ResourceRecordSets"]}

def alias(name):
    return {
        "Action": "UPSERT",
        "ResourceRecordSet": {
            "Name": name,
            "Type": "A",
            "AliasTarget": {
                "HostedZoneId": cf_zone,
                "DNSName": target,
                "EvaluateTargetHealth": False,
            },
        },
    }

def alias6(name):
    record = alias(name)
    record["ResourceRecordSet"]["Type"] = "AAAA"
    return record

changes = []
www_cname = by_key.get((www, "CNAME"))
if www_cname and "AliasTarget" not in www_cname:
    changes.append({"Action": "DELETE", "ResourceRecordSet": www_cname})
changes.extend([alias(apex), alias6(apex), alias(www), alias6(www)])

batch = {"Changes": changes}
subprocess.check_call([
    "aws", "route53", "change-resource-record-sets",
    "--hosted-zone-id", zone_id,
    "--change-batch", json.dumps(batch),
])
print("DNS now points at", target)
PY

echo "Deployed. https://${DOMAIN}/ will follow this distribution after DNS updates."
echo "Distribution: ${DISTRIBUTION_DOMAIN}"
