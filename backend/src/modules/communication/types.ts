export interface SmsNotificationRequest {
  farmerId: string;
  phone: string;
  message: string;
  purpose: 'weather_alert' | 'feedback_call' | 'manual_advisory' | 'call_reminder' | 'call_fallback' | 'system_notice';
  templateId?: string;
  templateCode?: string;
  relatedAlertId?: string;
  triggeredBy?: string;
  bypassQuietHours?: boolean;
}

export interface NotificationResult {
  id: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'blocked';
  errorReason?: string;
  providerMessageId?: string;
  isSimulated: boolean;
}

export interface FanOutSummary {
  alertId: string;
  villageId: string;
  eligibleFarmers: number;
  sentCount: number;
  blockedCount: number;
  failedCount: number;
}
