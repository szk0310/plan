# TASK 05: Terraform IaC 初版作成

> **優先度**: 🟢 中
> **対象ディレクトリ**: `infra/terraform/`（現在空）
> **依存**: なし（他タスクと並行可能）

---

## 背景

`infra/terraform/` ディレクトリは存在するが中身が空。
本番環境（GCP）のリソースをコードで管理できるようにする。

---

## 作成するファイル

### ファイル構成

```
infra/terraform/
├── main.tf          # プロバイダ設定 + メインリソース
├── variables.tf     # 変数定義
├── outputs.tf       # 出力定義
├── cloud_sql.tf     # Cloud SQL PostgreSQL
├── cloud_run.tf     # Cloud Run（api + web）
├── networking.tf    # VPC Connector
├── iam.tf           # Service Account + IAM
├── secrets.tf       # Secret Manager
└── terraform.tfvars.example  # 変数値の例
```

### `main.tf`

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # 本番では GCS バックエンドを使用
  # backend "gcs" {
  #   bucket = "slacksfa-terraform-state"
  #   prefix = "terraform/state"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 必要な API を有効化
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "cloudbuild.googleapis.com",
    "iap.googleapis.com",
    "speech.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}
```

### `variables.tf`

```hcl
variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "region" {
  description = "GCP リージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "db_tier" {
  description = "Cloud SQL マシンタイプ"
  type        = string
  default     = "db-g1-small"
}

variable "db_password" {
  description = "Cloud SQL ユーザーパスワード"
  type        = string
  sensitive   = true
}

variable "slack_bot_token" {
  description = "Slack Bot Token"
  type        = string
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack Signing Secret"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API Key"
  type        = string
  sensitive   = true
}
```

### `cloud_sql.tf`

```hcl
resource "google_sql_database_instance" "main" {
  name             = "slacksfa-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"  # JST 12:00
    }

    ip_configuration {
      ipv4_enabled    = false       # パブリック IP なし
      private_network = google_compute_network.vpc.id
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "slacksfa" {
  name     = "slacksfa"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "slacksfa_app"
  instance = google_sql_database_instance.main.name
  password = var.db_password
}
```

### `cloud_run.tf`

```hcl
# API サービス
resource "google_cloud_run_v2_service" "api" {
  name     = "slacksfa-api"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/slacksfa-api:latest"

      ports {
        container_port = 3000
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SLACK_BOT_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.slack_bot_token.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SLACK_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.slack_signing_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 5
        period_seconds        = 10
      }
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    service_account = google_service_account.api.email
  }

  depends_on = [google_project_service.apis]
}

# Slack Webhook は認証なしでアクセスが必要
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Web サービス
resource "google_cloud_run_v2_service" "web" {
  name     = "slacksfa-web"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/slacksfa-web:latest"

      ports {
        container_port = 80
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [google_project_service.apis]
}

# Web は IAP で保護（将来対応）
# resource "google_iap_web_iam_member" "web" { ... }
```

### `networking.tf`

```hcl
resource "google_compute_network" "vpc" {
  name                    = "slacksfa-vpc"
  auto_create_subnetworks = true
}

resource "google_vpc_access_connector" "connector" {
  name          = "slacksfa-connector"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"

  depends_on = [google_project_service.apis]
}

# Cloud SQL のプライベート IP 用
resource "google_compute_global_address" "private_ip" {
  name          = "slacksfa-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}
```

### `iam.tf`

```hcl
resource "google_service_account" "api" {
  account_id   = "slacksfa-api"
  display_name = "SlackSFA API Service Account"
}

resource "google_project_iam_member" "api_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_speech" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}
```

### `secrets.tf`

```hcl
resource "google_secret_manager_secret" "db_url" {
  secret_id = "slacksfa-db-url"
  replication { auto {} }
}

resource "google_secret_manager_secret" "slack_bot_token" {
  secret_id = "slacksfa-slack-bot-token"
  replication { auto {} }
}

resource "google_secret_manager_secret" "slack_signing_secret" {
  secret_id = "slacksfa-slack-signing-secret"
  replication { auto {} }
}

resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "slacksfa-anthropic-api-key"
  replication { auto {} }
}

# Secret のバージョン（値）は手動で設定すること
# gcloud secrets versions add slacksfa-db-url --data-file=- <<< "postgresql://..."
```

### `outputs.tf`

```hcl
output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "db_instance_connection_name" {
  value = google_sql_database_instance.main.connection_name
}
```

### `terraform.tfvars.example`

```hcl
project_id           = "your-gcp-project-id"
region               = "asia-northeast1"
db_tier              = "db-g1-small"
# 以下は terraform.tfvars に設定するか、-var で渡す
# db_password          = "..."
# slack_bot_token      = "xoxb-..."
# slack_signing_secret = "..."
# anthropic_api_key    = "sk-ant-..."
```

---

## 完了条件

- [ ] 上記の全ファイルが `infra/terraform/` に作成されている
- [ ] `terraform init` が成功する
- [ ] `terraform plan` がエラーなく実行できる（`terraform.tfvars` 未設定でもシンタックスエラーなし）
- [ ] `.gitignore` に `*.tfvars` と `.terraform/` が含まれている
