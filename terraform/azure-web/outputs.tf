output "static_website_endpoint" {
  description = "Public endpoint for the frontend shell. Private content remains behind the authenticated AWS API."
  value       = azurerm_storage_account.web.primary_web_endpoint
  depends_on  = [azurerm_storage_account_static_website.web]
}

output "storage_account_name" {
  description = "Storage account used to upload the Vite dist/ output."
  value       = azurerm_storage_account.web.name
}

output "resource_group_name" {
  value = azurerm_resource_group.web.name
}