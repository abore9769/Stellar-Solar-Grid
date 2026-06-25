const webhookUrls = new Set<string>();

export function registerWebhook(url: string): void {
  webhookUrls.add(url);
}

export function getWebhookUrls(): ReadonlySet<string> {
  return webhookUrls;
}
