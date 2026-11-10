variable "location" {
  description = "Azure region for the static frontend storage account."
  type        = string
  default     = "Central India"
}

variable "resource_group_name" {
  description = "Resource group containing the frontend hosting account."
  type        = string
  default     = "our-always-web-rg"
}

variable "name_prefix" {
  description = "Lowercase alphanumeric prefix for the globally unique Azure storage account."
  type        = string
  default     = "ouralways"

  validation {
    condition     = can(regex("^[a-z0-9]{3,15}$", var.name_prefix))
    error_message = "name_prefix must contain 3 to 15 lowercase letters or digits."
  }
}