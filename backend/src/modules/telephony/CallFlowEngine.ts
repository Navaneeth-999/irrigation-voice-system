import { CallSessionState, StepAction, CallCompletionPayload } from './types.js';
import {
  QUESTION_SPECS,
  QUESTION_OPTIONS,
  CROP_STAGE_OPTIONS,
  buildPromptText,
  SYSTEM_VOICE_PROMPTS,
  QuestionSpec,
} from './QuestionnaireConfig.js';

export class CallFlowEngine {
  /**
   * Initializes a brand new call session at Step 1 (Intro)
   */
  static initSession(params: {
    sessionId: string;
    phoneE164: string;
    provider: 'twilio' | 'simulator' | 'mock';
    callScheduleId?: string;
    seasonId?: string;
    farmerId?: string;
  }): { action: StepAction; state: CallSessionState } {
    const state: CallSessionState = {
      sessionId: params.sessionId,
      callScheduleId: params.callScheduleId,
      seasonId: params.seasonId,
      farmerId: params.farmerId,
      phoneE164: params.phoneE164,
      provider: params.provider,
      currentStep: 1,
      isCompleted: false,
      isOptedOut: false,
      questionRetryCount: 0,
      responses: {},
      promptHistory: ['prompt_intro_te'],
    };

    const spec = QUESTION_SPECS[1];
    const { teluguText, englishText } = buildPromptText(
      spec.basePromptTe,
      spec.basePromptEn,
      spec.options,
      spec.repeatKey
    );

    const action: StepAction = {
      type: 'PLAY_AND_GATHER',
      promptCode: spec.promptCode,
      teluguText,
      englishText,
      expectedInputType: spec.inputType as any,
      validDigits: '0,1,2,3,4,5,6,7,8,9',
      minDigits: spec.minDigits,
      maxDigits: spec.maxDigits,
      finishOnKey: spec.finishOnKey,
      timeoutSeconds: spec.timeoutSeconds,
      state,
    };

    return { action, state };
  }

  /**
   * Processes digits received from farmer DTMF
   */
  static handleInput(state: CallSessionState, rawInput: string): StepAction {
    const cleaned = (rawInput || '').trim();

    // 1. Repeat key '*'
    if (cleaned === '*') {
      state.questionRetryCount = 0;
      return this.renderStep(state);
    }

    // 2. Opt-Out check: STRICTLY permitted ONLY at Step 1 (Intro) or Step 99 (Goodbye)
    if (cleaned === '9' && (state.currentStep === 1 || state.currentStep === 99)) {
      state.isOptedOut = true;
      state.isCompleted = true;
      state.currentStep = -1;
      state.promptHistory.push(SYSTEM_VOICE_PROMPTS.opt_out_confirm.promptCode);

      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_VOICE_PROMPTS.opt_out_confirm.promptCode,
        teluguText: SYSTEM_VOICE_PROMPTS.opt_out_confirm.teluguText,
        englishText: SYSTEM_VOICE_PROMPTS.opt_out_confirm.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    // 3. Goodbye handling (Step 99)
    if (state.currentStep === 99) {
      state.isCompleted = true;
      state.currentStep = -2;
      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_VOICE_PROMPTS.goodbye.promptCode,
        teluguText: SYSTEM_VOICE_PROMPTS.goodbye.teluguText,
        englishText: SYSTEM_VOICE_PROMPTS.goodbye.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    const currentSpec = QUESTION_SPECS[state.currentStep];
    if (!currentSpec) {
      state.currentStep = 99;
      return this.renderGoodbye(state);
    }

    // 4. Validate and parse input
    const validation = this.validateAndParse(currentSpec, cleaned);
    if (!validation.isValid) {
      state.questionRetryCount += 1;
      if (state.questionRetryCount > 2) {
        state.isCompleted = true;
        state.currentStep = -2;
        return {
          type: 'TERMINATE',
          promptCode: SYSTEM_VOICE_PROMPTS.invalid_input.promptCode,
          teluguText: SYSTEM_VOICE_PROMPTS.invalid_input.teluguText,
          englishText: SYSTEM_VOICE_PROMPTS.invalid_input.englishText,
          expectedInputType: 'none',
          minDigits: 0,
          maxDigits: 0,
          finishOnKey: '',
          timeoutSeconds: 0,
          state,
        };
      }

      // Re-prompt
      state.promptHistory.push(SYSTEM_VOICE_PROMPTS.invalid_input.promptCode);
      const { teluguText, englishText } = buildPromptText(
        currentSpec.basePromptTe,
        currentSpec.basePromptEn,
        currentSpec.options,
        currentSpec.repeatKey
      );

      return {
        type: 'PLAY_AND_GATHER',
        promptCode: currentSpec.promptCode,
        teluguText: `${SYSTEM_VOICE_PROMPTS.invalid_input.teluguText} ${teluguText}`,
        englishText: `${SYSTEM_VOICE_PROMPTS.invalid_input.englishText} ${englishText}`,
        expectedInputType: currentSpec.inputType as any,
        validDigits: currentSpec.options ? currentSpec.options.map(o => o.digit).join(',') : undefined,
        minDigits: currentSpec.minDigits,
        maxDigits: currentSpec.maxDigits,
        finishOnKey: currentSpec.finishOnKey,
        timeoutSeconds: currentSpec.timeoutSeconds,
        state,
      };
    }

    // Valid entry!
    state.questionRetryCount = 0;
    state.responses[currentSpec.code] = {
      stepNumber: currentSpec.step,
      questionCode: currentSpec.code,
      promptCode: currentSpec.promptCode,
      rawDigits: cleaned,
      parsedValue: validation.parsedValue!,
      confidenceScore: 1.0,
      skipped: false,
    };

    // 5. Branching Rule 1: Irrigated == 2 (No) -> Skip count and hours to Step 6
    if (currentSpec.step === 3 && cleaned === '2') {
      state.responses['irrigation_count'] = {
        stepNumber: 4,
        questionCode: 'irrigation_count',
        promptCode: QUESTION_SPECS[4].promptCode,
        rawDigits: '0',
        parsedValue: 0,
        skipped: true,
        confidenceScore: 1.0,
      };
      state.responses['hours'] = {
        stepNumber: 5,
        questionCode: 'hours',
        promptCode: QUESTION_SPECS[5].promptCode,
        rawDigits: '0',
        parsedValue: 0,
        skipped: true,
        confidenceScore: 1.0,
      };
      state.currentStep = 6;
      return this.renderStep(state);
    }

    // 6. Branching Rule 2: Stage Confirmation == 2 (Different) -> Sub-step 72 (Select stage)
    if (currentSpec.step === 7) {
      if (cleaned === '2') {
        state.currentStep = 72; // Prompt for actual stage
        return this.renderStep(state);
      } else {
        state.currentStep = 8; // Advance to water_problem
        return this.renderStep(state);
      }
    }

    // If leaving sub-step 72, advance to step 8
    if (state.currentStep === 72) {
      state.currentStep = 8;
      return this.renderStep(state);
    }

    // 7. Step 10 (callback_requested) -> Advance to Step 11 (voice_note)
    if (state.currentStep === 10) {
      state.currentStep = 11;
      return this.renderStep(state);
    }

    // 8. Step 11 (voice_note) -> Advance to Step 99 (goodbye)
    if (state.currentStep === 11) {
      state.currentStep = 99;
      return this.renderGoodbye(state);
    }

    // Standard increment
    state.currentStep += 1;
    return this.renderStep(state);
  }

  /**
   * Handles timeout (silence)
   */
  static handleTimeout(state: CallSessionState): StepAction {
    state.questionRetryCount += 1;
    if (state.questionRetryCount > 2) {
      state.isCompleted = true;
      state.currentStep = -2;
      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_VOICE_PROMPTS.timeout.promptCode,
        teluguText: SYSTEM_VOICE_PROMPTS.timeout.teluguText,
        englishText: SYSTEM_VOICE_PROMPTS.timeout.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    const currentSpec = QUESTION_SPECS[state.currentStep] || QUESTION_SPECS[1];
    state.promptHistory.push(SYSTEM_VOICE_PROMPTS.timeout.promptCode);
    const { teluguText, englishText } = buildPromptText(
      currentSpec.basePromptTe,
      currentSpec.basePromptEn,
      currentSpec.options,
      currentSpec.repeatKey
    );

    return {
      type: 'PLAY_AND_GATHER',
      promptCode: currentSpec.promptCode,
      teluguText: `${SYSTEM_VOICE_PROMPTS.timeout.teluguText} ${teluguText}`,
      englishText: `${SYSTEM_VOICE_PROMPTS.timeout.englishText} ${englishText}`,
      expectedInputType: currentSpec.inputType as any,
      validDigits: currentSpec.options ? currentSpec.options.map(o => o.digit).join(',') : undefined,
      minDigits: currentSpec.minDigits,
      maxDigits: currentSpec.maxDigits,
      finishOnKey: currentSpec.finishOnKey,
      timeoutSeconds: currentSpec.timeoutSeconds,
      state,
    };
  }

  private static renderStep(state: CallSessionState): StepAction {
    const spec = QUESTION_SPECS[state.currentStep];
    state.promptHistory.push(spec.promptCode);
    const { teluguText, englishText } = buildPromptText(
      spec.basePromptTe,
      spec.basePromptEn,
      spec.options,
      spec.repeatKey
    );

    return {
      type: 'PLAY_AND_GATHER',
      promptCode: spec.promptCode,
      teluguText,
      englishText,
      expectedInputType: spec.inputType as any,
      validDigits: spec.options ? spec.options.map(o => o.digit).join(',') : undefined,
      minDigits: spec.minDigits,
      maxDigits: spec.maxDigits,
      finishOnKey: spec.finishOnKey,
      timeoutSeconds: spec.timeoutSeconds,
      state,
    };
  }

  private static renderGoodbye(state: CallSessionState): StepAction {
    state.promptHistory.push(SYSTEM_VOICE_PROMPTS.goodbye.promptCode);
    return {
      type: 'PLAY_AND_GATHER',
      promptCode: SYSTEM_VOICE_PROMPTS.goodbye.promptCode,
      teluguText: SYSTEM_VOICE_PROMPTS.goodbye.teluguText,
      englishText: SYSTEM_VOICE_PROMPTS.goodbye.englishText,
      expectedInputType: 'single_digit',
      validDigits: '9',
      minDigits: 1,
      maxDigits: 1,
      finishOnKey: '#',
      timeoutSeconds: 5,
      state,
    };
  }

  private static validateAndParse(
    spec: QuestionSpec,
    rawDigits: string
  ): { isValid: boolean; parsedValue?: any } {
    const cleaned = rawDigits.replace(/#/g, '').trim();

    if (spec.inputType === 'voice_recording') {
      // Voice recording can be skipped with 1 or #, or passed with audio URL
      return { isValid: true, parsedValue: cleaned || 'recorded' };
    }

    if (!cleaned) {
      return { isValid: false };
    }

    // Single digit with options table
    if (spec.options && spec.options.length > 0) {
      const match = spec.options.find(o => o.digit === cleaned);
      if (match) {
        return { isValid: true, parsedValue: match.value };
      }
      return { isValid: false };
    }

    switch (spec.code) {
      case 'intro':
        return { isValid: /^[0-9]$/.test(cleaned), parsedValue: cleaned };

      case 'irrigation_count': {
        const count = parseInt(cleaned, 10);
        if (!isNaN(count) && count >= 1 && count <= 30) {
          return { isValid: true, parsedValue: count };
        }
        return { isValid: false };
      }

      case 'hours': {
        // Total running hours for the period (1 to 999)
        const hours = parseFloat(cleaned);
        if (!isNaN(hours) && hours > 0 && hours <= 999) {
          return { isValid: true, parsedValue: hours };
        }
        return { isValid: false };
      }

      default:
        return { isValid: true, parsedValue: cleaned };
    }
  }

  /**
   * Transforms responses into standardized CallCompletionPayload
   * Note: "hours" is TOTAL running hours for the period!
   */
  static extractCompletionPayload(
    state: CallSessionState,
    cycleNumber: number
  ): CallCompletionPayload {
    const res = state.responses;

    const irrigated = res['irrigated']?.parsedValue === 'yes';
    const irrigationCount = irrigated ? Number(res['irrigation_count']?.parsedValue || 1) : 0;
    // TOTAL pump running hours for the period:
    const totalPumpHours = irrigated ? Number(res['hours']?.parsedValue || 0) : 0;
    const stageConfirmed = res['stage_confirmation']?.parsedValue === 'confirmed';
    const reportedStage = !stageConfirmed ? (res['reported_stage_select']?.parsedValue as string | undefined) : undefined;

    return {
      seasonId: state.seasonId || '',
      farmerId: state.farmerId || '',
      cycleNumber,
      source: state.provider === 'simulator' ? 'simulator' : 'ivr',
      isSimulated: state.provider === 'simulator',
      rainfallCategory: (res['rain']?.parsedValue as any) || 'none',
      irrigated,
      irrigationCount,
      totalPumpHours,
      hoursPerIrrigation: totalPumpHours, // represents total hours for the period
      cropCondition: (res['crop_condition']?.parsedValue as any) || 'good',
      stageConfirmed,
      reportedStage,
      waterProblem: (res['water_problem']?.parsedValue as any) || 'none',
      cropProblem: (res['crop_problem']?.parsedValue as any) || 'none',
      callbackRequested: res['callback_requested']?.parsedValue === 'yes',
      voiceNoteUrl: (res['voice_note']?.parsedValue as string | undefined),
    };
  }
}
