export type TelephonyProvider = 'twilio' | 'simulator' | 'mock';

export type CallScheduleStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'opted_out';

export type CallAttemptStatus =
  | 'initiated'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'busy'
  | 'no_answer'
  | 'failed'
  | 'cancelled';

export type AudioReviewStatus =
  | 'draft'
  | 'recorded'
  | 'reviewed_agronomist'
  | 'approved'
  | 'rejected';

export interface CallResponseEntry {
  stepNumber: number;
  questionCode: string;
  promptCode: string;
  rawDigits: string;
  parsedValue: string | number;
  skipped?: boolean;
  confidenceScore?: number;
}

export interface CallSessionState {
  sessionId: string;
  callScheduleId?: string;
  seasonId?: string;
  farmerId?: string;
  phoneE164: string;
  provider: TelephonyProvider;
  currentStep: number; // 1 to 10; 99 = goodbye; -1 = opted_out; -2 = failed
  isCompleted: boolean;
  isOptedOut: boolean;
  questionRetryCount: number;
  responses: Record<string, CallResponseEntry>;
  promptHistory: string[];
}

export interface StepAction {
  type: 'PLAY_AND_GATHER' | 'TERMINATE';
  promptCode: string;
  teluguText: string;
  englishText: string;
  expectedInputType: 'single_digit' | 'multi_digit' | 'voice_recording' | 'none';
  validDigits?: string;
  minDigits: number;
  maxDigits: number;
  finishOnKey: string;
  timeoutSeconds: number;
  state: CallSessionState;
}

export interface CallCompletionPayload {
  seasonId: string;
  farmerId: string;
  cycleNumber: number;
  source: 'ivr' | 'simulator';
  isSimulated: boolean;
  rainfallCategory: 'none' | 'light' | 'moderate' | 'heavy';
  irrigated: boolean;
  irrigationCount?: number;
  totalPumpHours?: number;
  hoursPerIrrigation?: number; // legacy alias
  cropCondition: 'good' | 'average' | 'poor';
  stageConfirmed: boolean;
  reportedStage?: string;
  waterProblem: 'none' | 'shortage' | 'pump_power_issue' | 'source_depleted';
  cropProblem: 'none' | 'pest_disease' | 'yellowing_drying' | 'other';
  callbackRequested: boolean;
  voiceNoteUrl?: string;
}

