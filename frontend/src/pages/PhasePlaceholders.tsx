import React from 'react';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';

interface PhasePlaceholderProps {
  title: string;
  phase: string;
  description: string;
  icon?: string;
}

export const PhasePlaceholder: React.FC<PhasePlaceholderProps> = ({
  title,
  phase,
  description,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <Badge variant="warning">{phase}</Badge>
      </div>

      <Card>
        <div className="py-16 text-center max-w-lg mx-auto space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-xl font-bold border border-amber-200">
            ⏳
          </div>
          <h3 className="text-base font-semibold text-gray-800">Module Scheduled in {phase}</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            This module is part of the approved phased development pipeline. The backend database tables,
            migrations, and domain services will be integrated in sequence.
          </p>
        </div>
      </Card>
    </div>
  );
};

export const SeasonsPage = () => (
  <PhasePlaceholder
    title="Seasonal Lifecycle & Crop Progress"
    phase="Phase 2"
    description="Manage cultivation seasons, snapshot freezing, irrigation events, and progress tracking."
  />
);

export const WeatherPage = () => (
  <PhasePlaceholder
    title="Weather & Advisory Alerts"
    phase="Phase 4"
    description="Open-Meteo forecasts, IMD weather rules, deduplication, and voice alert fan-out."
  />
);

export const CallSimulatorPage = () => (
  <PhasePlaceholder
    title="Telugu Voice Call & DTMF Simulator"
    phase="Phase 3"
    description="Interactive keypad simulator running the pure CallFlowEngine state machine."
  />
);

export const AnalyticsPage = () => (
  <PhasePlaceholder
    title="Seasonal Conservation Analytics"
    phase="Phase 5"
    description="FAO-56 evapotranspiration models, paddy ponding calculations, and data confidence scoring."
  />
);

export const CertificatesPage = () => (
  <PhasePlaceholder
    title="Irrigation Records & Certificates"
    phase="Phase 6"
    description="Immutable JSON snapshot certificates, SHA-256 validation, and Telugu PDF downloads."
  />
);

export const SettingsPage = () => (
  <PhasePlaceholder
    title="System Configuration & Thresholds"
    phase="Admin Core"
    description="Configure call retry limits, effective rainfall parameters, and confidence weights."
  />
);

export const AuditPage = () => (
  <PhasePlaceholder
    title="System Audit Trail"
    phase="Admin Core"
    description="Tamper-proof append-only audit trail logging user actions and sensitive data access."
  />
);

export const PublicVerifyPage = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-gray-200 text-center">
      <h2 className="text-xl font-bold text-gray-900">Certificate Public Verification</h2>
      <p className="text-xs text-gray-500 mt-2">Public QR verification service (scheduled in Phase 6).</p>
    </div>
  </div>
);
