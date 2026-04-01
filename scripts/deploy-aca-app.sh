#!/usr/bin/env bash
# Deploy the SignalForge app to Azure Container Apps from the checked-in Bicep template.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_FILE="${REPO_ROOT}/infra/aca/main.bicep"

MODE="create"
RESOURCE_GROUP="${ACA_RESOURCE_GROUP:-}"
LOCATION="${ACA_LOCATION:-}"
ENVIRONMENT_ID="${ACA_ENVIRONMENT_ID:-}"
APP_NAME="${ACA_CONTAINER_APP_NAME:-ca-signalforge}"
IMAGE="${ACA_IMAGE:-}"
REGISTRY_SERVER="${ACA_REGISTRY_SERVER:-}"
REGISTRY_IDENTITY_RESOURCE_ID="${ACA_REGISTRY_IDENTITY_RESOURCE_ID:-}"
CPU="${ACA_CPU:-0.5}"
MEMORY="${ACA_MEMORY:-1Gi}"
MIN_REPLICAS="${ACA_MIN_REPLICAS:-0}"
MAX_REPLICAS="${ACA_MAX_REPLICAS:-3}"
TARGET_PORT="${ACA_TARGET_PORT:-3000}"
REVISION_SUFFIX="${ACA_REVISION_SUFFIX:-}"
CUSTOM_DOMAINS_JSON="${ACA_CUSTOM_DOMAINS_JSON:-}"
TAGS_JSON="${ACA_TAGS_JSON:-{\"app\":\"signalforge\",\"surface\":\"aca\",\"role\":\"app\"}}"
LLM_PROVIDER="${ACA_LLM_PROVIDER:-}"
OPENAI_MODEL="${ACA_OPENAI_MODEL:-gpt-5-mini}"
AZURE_OPENAI_ENDPOINT="${ACA_AZURE_OPENAI_ENDPOINT:-}"
AZURE_OPENAI_DEPLOYMENT="${ACA_AZURE_OPENAI_DEPLOYMENT:-}"
AZURE_OPENAI_API_VERSION="${ACA_AZURE_OPENAI_API_VERSION:-}"

ACA_DATABASE_URL_VALUE="${ACA_DATABASE_URL:-}"
ACA_ADMIN_TOKEN_VALUE="${ACA_ADMIN_TOKEN:-}"
ACA_OPENAI_API_KEY_VALUE="${ACA_OPENAI_API_KEY:-}"
ACA_AZURE_OPENAI_API_KEY_VALUE="${ACA_AZURE_OPENAI_API_KEY:-}"

show_help() {
  cat <<'EOF'
Deploy the SignalForge app to Azure Container Apps from the checked-in Bicep template.

Usage:
  bash scripts/deploy-aca-app.sh [options]

Required options:
  --resource-group VALUE     Azure resource group that owns the ACA app
  --environment-id VALUE     Existing ACA managed environment resource ID
  --image VALUE              Container image reference to deploy

Optional options:
  --app-name VALUE           Container App name (default: ca-signalforge)
  --location VALUE           Azure region. Defaults to the managed-environment location.
  --registry-server VALUE    Optional private registry server
  --registry-identity-resource-id VALUE
                             Optional user-assigned identity for private registry pulls
  --cpu VALUE                ACA CPU setting (default: 0.5)
  --memory VALUE             ACA memory setting (default: 1Gi)
  --min-replicas VALUE       Minimum replicas (default: 0)
  --max-replicas VALUE       Maximum replicas (default: 3)
  --target-port VALUE        Container port (default: 3000)
  --revision-suffix VALUE    Explicit ACA revision suffix
  --custom-domains-json VALUE
                             JSON array of ACA ingress custom-domain bindings
  --tags-json VALUE          JSON object for ACA tags
  --llm-provider VALUE       '', openai, or azure
  --openai-model VALUE       OpenAI model override
  --azure-openai-endpoint VALUE
  --azure-openai-deployment VALUE
  --azure-openai-api-version VALUE
  --what-if                  Run az deployment group what-if instead of create
  -h, --help                 Show this help

Required environment:
  ACA_DATABASE_URL           Postgres connection string for the app
  ACA_ADMIN_TOKEN            SIGNALFORGE_ADMIN_TOKEN value for the app

Optional secret environment:
  ACA_OPENAI_API_KEY
  ACA_AZURE_OPENAI_API_KEY

Examples:
  ACA_DATABASE_URL=postgres://... \
  ACA_ADMIN_TOKEN=replace-me \
  bash scripts/deploy-aca-app.sh \
    --resource-group rg-canepro-ph-dev-eus \
    --environment-id /subscriptions/.../managedEnvironments/cae-canepro-ph-dev-eus \
    --image ghcr.io/canepro/signalforge:0123456789abcdef \
    --custom-domains-json '[{"name":"signalforge.example.com","bindingType":"SniEnabled","certificateId":"/subscriptions/.../managedCertificates/signalforge-example-cert"}]' \
    --llm-provider azure \
    --azure-openai-endpoint https://example.openai.azure.com/openai/v1/ \
    --azure-openai-deployment gpt-5.4-mini \
    --what-if
EOF
}

derive_revision_suffix() {
  local image_ref="$1"
  local tag="${image_ref##*:}"

  if [[ "$image_ref" == "$tag" ]]; then
    return 0
  fi

  if [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]]; then
    printf 'sha%s' "${tag:0:12}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group)
      RESOURCE_GROUP="${2:?missing value after $1}"
      shift 2
      ;;
    --location)
      LOCATION="${2:?missing value after $1}"
      shift 2
      ;;
    --environment-id)
      ENVIRONMENT_ID="${2:?missing value after $1}"
      shift 2
      ;;
    --app-name)
      APP_NAME="${2:?missing value after $1}"
      shift 2
      ;;
    --image)
      IMAGE="${2:?missing value after $1}"
      shift 2
      ;;
    --registry-server)
      REGISTRY_SERVER="${2:?missing value after $1}"
      shift 2
      ;;
    --registry-identity-resource-id)
      REGISTRY_IDENTITY_RESOURCE_ID="${2:?missing value after $1}"
      shift 2
      ;;
    --cpu)
      CPU="${2:?missing value after $1}"
      shift 2
      ;;
    --memory)
      MEMORY="${2:?missing value after $1}"
      shift 2
      ;;
    --min-replicas)
      MIN_REPLICAS="${2:?missing value after $1}"
      shift 2
      ;;
    --max-replicas)
      MAX_REPLICAS="${2:?missing value after $1}"
      shift 2
      ;;
    --target-port)
      TARGET_PORT="${2:?missing value after $1}"
      shift 2
      ;;
    --revision-suffix)
      REVISION_SUFFIX="${2:?missing value after $1}"
      shift 2
      ;;
    --custom-domains-json)
      CUSTOM_DOMAINS_JSON="${2:?missing value after $1}"
      shift 2
      ;;
    --tags-json)
      TAGS_JSON="${2:?missing value after $1}"
      shift 2
      ;;
    --llm-provider)
      LLM_PROVIDER="${2:?missing value after $1}"
      shift 2
      ;;
    --openai-model)
      OPENAI_MODEL="${2:?missing value after $1}"
      shift 2
      ;;
    --azure-openai-endpoint)
      AZURE_OPENAI_ENDPOINT="${2:?missing value after $1}"
      shift 2
      ;;
    --azure-openai-deployment)
      AZURE_OPENAI_DEPLOYMENT="${2:?missing value after $1}"
      shift 2
      ;;
    --azure-openai-api-version)
      AZURE_OPENAI_API_VERSION="${2:?missing value after $1}"
      shift 2
      ;;
    --what-if)
      MODE="what-if"
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "error: --resource-group is required" >&2
  exit 1
fi
if [[ -z "$ENVIRONMENT_ID" ]]; then
  echo "error: --environment-id is required" >&2
  exit 1
fi
if [[ -z "$IMAGE" ]]; then
  echo "error: --image is required" >&2
  exit 1
fi
if [[ -z "$ACA_DATABASE_URL_VALUE" ]]; then
  echo "error: ACA_DATABASE_URL must be set" >&2
  exit 1
fi
if [[ -z "$ACA_ADMIN_TOKEN_VALUE" ]]; then
  echo "error: ACA_ADMIN_TOKEN must be set" >&2
  exit 1
fi

case "$LLM_PROVIDER" in
  "")
    ;;
  openai)
    if [[ -z "$ACA_OPENAI_API_KEY_VALUE" ]]; then
      echo "error: ACA_OPENAI_API_KEY must be set when --llm-provider openai is used" >&2
      exit 1
    fi
    ;;
  azure)
    if [[ -z "$AZURE_OPENAI_ENDPOINT" || -z "$AZURE_OPENAI_DEPLOYMENT" ]]; then
      echo "error: --azure-openai-endpoint and --azure-openai-deployment are required when --llm-provider azure is used" >&2
      exit 1
    fi
    if [[ -z "$ACA_AZURE_OPENAI_API_KEY_VALUE" ]]; then
      echo "error: ACA_AZURE_OPENAI_API_KEY must be set when --llm-provider azure is used" >&2
      exit 1
    fi
    ;;
  *)
    echo "error: unsupported --llm-provider value: $LLM_PROVIDER" >&2
    exit 1
    ;;
esac

if [[ -z "$LOCATION" ]]; then
  LOCATION="$(az resource show --ids "$ENVIRONMENT_ID" --query location --output tsv)"
fi

if [[ -z "$LOCATION" ]]; then
  LOCATION="$(az group show --name "$RESOURCE_GROUP" --query location --output tsv)"
fi

if [[ -z "$LOCATION" ]]; then
  echo "error: could not determine Azure location from ACA environment $ENVIRONMENT_ID or resource group $RESOURCE_GROUP" >&2
  exit 1
fi

LOCATION="${LOCATION//$'\r'/}"

if [[ -z "$REVISION_SUFFIX" ]]; then
  REVISION_SUFFIX="$(derive_revision_suffix "$IMAGE" || true)"
fi

if [[ -z "$CUSTOM_DOMAINS_JSON" ]]; then
  if az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    CUSTOM_DOMAINS_JSON="$(az containerapp show \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query 'properties.configuration.ingress.customDomains' \
      --output json | tr -d '\r\n')"

    if [[ "$CUSTOM_DOMAINS_JSON" == "null" || -z "$CUSTOM_DOMAINS_JSON" ]]; then
      CUSTOM_DOMAINS_JSON='[]'
    fi
  else
    CUSTOM_DOMAINS_JSON='[]'
  fi
fi

echo "Template: ${TEMPLATE_FILE}"
echo "Mode: ${MODE}"
echo "Resource group: ${RESOURCE_GROUP}"
echo "Location: ${LOCATION}"
echo "App name: ${APP_NAME}"
echo "Image: ${IMAGE}"
if [[ -n "$REVISION_SUFFIX" ]]; then
  echo "Revision suffix: ${REVISION_SUFFIX}"
fi
if [[ "$CUSTOM_DOMAINS_JSON" != "[]" ]]; then
  echo "Custom domains: ${CUSTOM_DOMAINS_JSON}"
fi

AZ_ARGS=(
  az deployment group "${MODE}"
  --resource-group "${RESOURCE_GROUP}"
  --template-file "${TEMPLATE_FILE}"
  --parameters "location=${LOCATION}"
  --parameters "containerAppName=${APP_NAME}"
  --parameters "containerAppsEnvironmentId=${ENVIRONMENT_ID}"
  --parameters "image=${IMAGE}"
  --parameters "registryServer=${REGISTRY_SERVER}"
  --parameters "registryIdentityResourceId=${REGISTRY_IDENTITY_RESOURCE_ID}"
  --parameters "cpu=${CPU}"
  --parameters "memory=${MEMORY}"
  --parameters "minReplicas=${MIN_REPLICAS}"
  --parameters "maxReplicas=${MAX_REPLICAS}"
  --parameters "targetPort=${TARGET_PORT}"
  --parameters "databaseUrl=${ACA_DATABASE_URL_VALUE}"
  --parameters "signalforgeAdminToken=${ACA_ADMIN_TOKEN_VALUE}"
  --parameters "llmProvider=${LLM_PROVIDER}"
  --parameters "openAiApiKey=${ACA_OPENAI_API_KEY_VALUE}"
  --parameters "openAiModel=${OPENAI_MODEL}"
  --parameters "azureOpenAiEndpoint=${AZURE_OPENAI_ENDPOINT}"
  --parameters "azureOpenAiApiKey=${ACA_AZURE_OPENAI_API_KEY_VALUE}"
  --parameters "azureOpenAiDeployment=${AZURE_OPENAI_DEPLOYMENT}"
  --parameters "azureOpenAiApiVersion=${AZURE_OPENAI_API_VERSION}"
  --parameters "revisionSuffix=${REVISION_SUFFIX}"
  --parameters "customDomains=${CUSTOM_DOMAINS_JSON}"
  --parameters "tags=${TAGS_JSON}"
)

"${AZ_ARGS[@]}"
