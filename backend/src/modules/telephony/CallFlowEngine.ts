import { CallSessionState, StepAction, CallCompletionPayload, CallResponseEntry } from './types.js';

export interface QuestionDefinition {
  step: number;
  code: string;
  promptCode: string;
  teluguText: string;
  englishText: string;
  inputType: 'single_digit' | 'multi_digit';
  validDigits?: string[];
  minDigits: number;
  maxDigits: number;
  finishOnKey: string;
  timeoutSeconds: number;
  repeatKey: string;
  optOutKey?: string;
  skipRule?: { depends_on: string; skip_if_value: string; skip_to_step: number };
}

export const QUESTION_DEFINITIONS: Record<number, QuestionDefinition> = {
  1: {
    step: 1,
    code: 'intro',
    promptCode: 'prompt_intro_te',
    teluguText: 'నమస్కారం! మీ పంట నీటిపారుదల సమాచారం కొరకు ఈ కాల్. కాల్ కొనసాగించడానికి ఏదైనా అంకె నొక్కండి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి.',
    englishText: 'Greeting! This call is to collect irrigation feedback for your crop. Press any key to continue. Press 9 to stop receiving calls.',
    inputType: 'single_digit',
    validDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    optOutKey: '9',
  },
  2: {
    step: 2,
    code: 'rain',
    promptCode: 'prompt_rain_te',
    teluguText: 'గత 14 రోజులలో మీ పొలంలో వర్షం ఎలా కురిసింది? వర్షం లేకపోతే 0, స్వల్ప వర్షం అయితే 1, మోస్తరు వర్షం అయితే 2, భారీ వర్షం అయితే 3 నొక్కండి. పునరావృతం చేయడానికి * నొక్కండి.',
    englishText: 'How was the rainfall in your field over the last 14 days? Press 0 for none, 1 for light, 2 for moderate, 3 for heavy. Press * to repeat.',
    inputType: 'single_digit',
    validDigits: ['0', '1', '2', '3'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
  3: {
    step: 3,
    code: 'irrigated',
    promptCode: 'prompt_irrigated_te',
    teluguText: 'గత 14 రోజులలో మీరు పొలానికి నీరు పెట్టారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి.',
    englishText: 'Did you irrigate your field in the last 14 days? Press 1 for Yes, 2 for No.',
    inputType: 'single_digit',
    validDigits: ['1', '2'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    skipRule: { depends_on: 'irrigated', skip_if_value: '2', skip_to_step: 6 },
  },
  4: {
    step: 4,
    code: 'irrigation_count',
    promptCode: 'prompt_irrigation_count_te',
    teluguText: 'గత 14 రోజులలో ఎన్ని సార్లు నీరు పెట్టారు? సంఖ్యను నొక్కి # నొక్కండి.',
    englishText: 'How many times did you irrigate in the last 14 days? Enter number and press #.',
    inputType: 'multi_digit',
    minDigits: 1,
    maxDigits: 2,
    finishOnKey: '#',
    timeoutSeconds: 6,
    repeatKey: '*',
  },
  5: {
    step: 5,
    code: 'hours',
    promptCode: 'prompt_hours_te',
    teluguText: 'ఒక్కో తడికి సగటున మోటార్ ఎన్ని గంటలు నడిపారు? గంటల సంఖ్యను నొక్కి # నొక్కండి.',
    englishText: 'On average, how many hours did the pump run per irrigation? Enter hours and press #.',
    inputType: 'multi_digit',
    minDigits: 1,
    maxDigits: 2,
    finishOnKey: '#',
    timeoutSeconds: 6,
    repeatKey: '*',
  },
  6: {
    step: 6,
    code: 'crop_condition',
    promptCode: 'prompt_crop_condition_te',
    teluguText: 'మీ ప్రస్తుత పంట పరిస్థితి ఎలా ఉంది? బాగుంటే 1, సాధారణంగా ఉంటే 2, బాగోలేకపోతే 3 నొక్కండి.',
    englishText: 'How is your current crop condition? Press 1 for Good, 2 for Average, 3 for Poor.',
    inputType: 'single_digit',
    validDigits: ['1', '2', '3'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
  7: {
    step: 7,
    code: 'stage_confirmation',
    promptCode: 'prompt_stage_confirmation_te',
    teluguText: 'వ్యవసాయ శాఖ అంచనా ప్రకారం మీ పంట ప్రస్తుతం పెరుగుదల దశలో ఉంది. ఇది సరైనదేనా? అవును అయితే 1, కాదు అయితే 2 నొక్కండి.',
    englishText: 'According to records, your crop is currently in the expected stage. Is this correct? Press 1 for Yes, 2 for No.',
    inputType: 'single_digit',
    validDigits: ['1', '2'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
  8: {
    step: 8,
    code: 'water_problem',
    promptCode: 'prompt_water_problem_te',
    teluguText: 'నీటి లభ్యతలో ఏమైనా సమస్య ఉందా? సమస్య లేకపోతే 0, నీటి కొరత అయితే 1, మోటార్ లేదా కరెంట్ సమస్య అయితే 2, నీటి వనరు ఎండిపోతే 3 నొక్కండి.',
    englishText: 'Any water problems? 0 for none, 1 for shortage, 2 for motor/power issue, 3 for source dried up.',
    inputType: 'single_digit',
    validDigits: ['0', '1', '2', '3'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
  9: {
    step: 9,
    code: 'crop_problem',
    promptCode: 'prompt_crop_problem_te',
    teluguText: 'పంటలో ఏమైనా ఇతర సమస్యలు ఉన్నాయా? సమస్య లేకపోతే 0, తెగుళ్లు లేదా పురుగు అయితే 1, ఆకులు పసుపుపచ్చగా మారడం లేదా ఎండిపోవడం అయితే 2, ఇతర సమస్య అయితే 3 నొక్కండి.',
    englishText: 'Any crop problems? 0 for none, 1 for pests/disease, 2 for yellowing/drying, 3 for other issues.',
    inputType: 'single_digit',
    validDigits: ['0', '1', '2', '3'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
  10: {
    step: 10,
    code: 'callback_requested',
    promptCode: 'prompt_callback_requested_te',
    teluguText: 'వ్యవసాయ అధికారి లేదా వాలంటీర్ మీతో మాట్లాడాలని కోరుకుంటున్నారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి.',
    englishText: 'Would you like an agricultural officer or volunteer to call you back? Press 1 for Yes, 2 for No.',
    inputType: 'single_digit',
    validDigits: ['1', '2'],
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
  },
};

export const SYSTEM_PROMPTS = {
  invalid_input: {
    promptCode: 'prompt_invalid_input_te',
    teluguText: 'క్షమించండి, మీరు నొక్కిన అంకె సరికాదు. దయచేసి సరైన అంకెను మళ్ళీ నొక్కండి.',
    englishText: 'Sorry, that was not a valid entry. Please try again.',
  },
  timeout: {
    promptCode: 'prompt_timeout_te',
    teluguText: 'సమాధానం అందలేదు. దయచేసి అంకెను నొక్కండి.',
    englishText: 'We did not receive a response. Please press a key.',
  },
  opt_out_confirm: {
    promptCode: 'prompt_opt_out_confirm_te',
    teluguText: 'మీ అభ్యర్థన మేరకు భవిష్యత్తులో ఈ నంబర్‌కు ఆటోమేటిక్ కాల్స్ నిలిపివేయబడ్డాయి. ధన్యవాదాలు.',
    englishText: 'Per your request, automated calls to this number have been stopped. Thank you.',
  },
  goodbye: {
    promptCode: 'prompt_goodbye_te',
    teluguText: 'మీ అమూల్యమైన సమాచారానికి ధన్యవాదాలు. మీ వివరాలు నమోదు చేయబడ్డాయి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి. శుభం!',
    englishText: 'Thank you for your valuable information. Your feedback is recorded. Press 9 to opt out of future calls. Goodbye!',
  },
};

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

    const def = QUESTION_DEFINITIONS[1];
    const action: StepAction = {
      type: 'PLAY_AND_GATHER',
      promptCode: def.promptCode,
      teluguText: def.teluguText,
      englishText: def.englishText,
      expectedInputType: def.inputType,
      validDigits: def.validDigits?.join(','),
      minDigits: def.minDigits,
      maxDigits: def.maxDigits,
      finishOnKey: def.finishOnKey,
      timeoutSeconds: def.timeoutSeconds,
      state,
    };

    return { action, state };
  }

  /**
   * Processes digits received from farmer DTMF
   */
  static handleInput(state: CallSessionState, rawInput: string): StepAction {
    const cleaned = (rawInput || '').trim();

    // 1. Check for Repeat Key '*'
    if (cleaned === '*') {
      state.questionRetryCount = 0;
      return this.renderStep(state);
    }

    // 2. Check for Opt-Out (Only allowed on Step 1 Intro or Step 99 Goodbye)
    if (cleaned === '9' && (state.currentStep === 1 || state.currentStep === 99)) {
      state.isOptedOut = true;
      state.isCompleted = true;
      state.currentStep = -1;
      state.promptHistory.push(SYSTEM_PROMPTS.opt_out_confirm.promptCode);

      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_PROMPTS.opt_out_confirm.promptCode,
        teluguText: SYSTEM_PROMPTS.opt_out_confirm.teluguText,
        englishText: SYSTEM_PROMPTS.opt_out_confirm.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    // 3. Goodbye state handling (Step 99)
    if (state.currentStep === 99) {
      state.isCompleted = true;
      state.currentStep = -2;
      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_PROMPTS.goodbye.promptCode,
        teluguText: SYSTEM_PROMPTS.goodbye.teluguText,
        englishText: SYSTEM_PROMPTS.goodbye.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    const currentDef = QUESTION_DEFINITIONS[state.currentStep];
    if (!currentDef) {
      state.isCompleted = true;
      return this.renderGoodbye(state);
    }

    // 4. Validate input against question definition
    const validation = this.validateAndParse(currentDef, cleaned);
    if (!validation.isValid) {
      state.questionRetryCount += 1;
      if (state.questionRetryCount > 2) {
        // Exceeded retries for this question: fail call gracefully
        state.isCompleted = true;
        state.currentStep = -2;
        return {
          type: 'TERMINATE',
          promptCode: SYSTEM_PROMPTS.invalid_input.promptCode,
          teluguText: SYSTEM_PROMPTS.invalid_input.teluguText,
          englishText: SYSTEM_PROMPTS.invalid_input.englishText,
          expectedInputType: 'none',
          minDigits: 0,
          maxDigits: 0,
          finishOnKey: '',
          timeoutSeconds: 0,
          state,
        };
      }

      // Re-prompt with invalid input message + repeat current question
      state.promptHistory.push(SYSTEM_PROMPTS.invalid_input.promptCode);
      return {
        type: 'PLAY_AND_GATHER',
        promptCode: currentDef.promptCode,
        teluguText: `${SYSTEM_PROMPTS.invalid_input.teluguText} ${currentDef.teluguText}`,
        englishText: `${SYSTEM_PROMPTS.invalid_input.englishText} ${currentDef.englishText}`,
        expectedInputType: currentDef.inputType,
        validDigits: currentDef.validDigits?.join(','),
        minDigits: currentDef.minDigits,
        maxDigits: currentDef.maxDigits,
        finishOnKey: currentDef.finishOnKey,
        timeoutSeconds: currentDef.timeoutSeconds,
        state,
      };
    }

    // Valid input! Reset retry count and save response
    state.questionRetryCount = 0;
    state.responses[currentDef.code] = {
      stepNumber: currentDef.step,
      questionCode: currentDef.code,
      promptCode: currentDef.promptCode,
      rawDigits: cleaned,
      parsedValue: validation.parsedValue!,
      confidenceScore: 1.0,
      skipped: false,
    };

    // 5. Check Skip Rule (Branching logic)
    // If Question 3 (irrigated) == '2' (No), skip Question 4 (count) and Question 5 (hours)
    if (currentDef.skipRule && String(cleaned) === currentDef.skipRule.skip_if_value) {
      if (currentDef.step === 3) {
        // Record skipped questions for completeness
        state.responses['irrigation_count'] = {
          stepNumber: 4,
          questionCode: 'irrigation_count',
          promptCode: QUESTION_DEFINITIONS[4].promptCode,
          rawDigits: '0',
          parsedValue: 0,
          skipped: true,
          confidenceScore: 1.0,
        };
        state.responses['hours'] = {
          stepNumber: 5,
          questionCode: 'hours',
          promptCode: QUESTION_DEFINITIONS[5].promptCode,
          rawDigits: '0',
          parsedValue: 0,
          skipped: true,
          confidenceScore: 1.0,
        };
      }
      state.currentStep = currentDef.skipRule.skip_to_step;
      return this.renderStep(state);
    }

    // 6. Advance to next step
    if (state.currentStep >= 10) {
      // Completed all 10 questions -> Proceed to Goodbye
      state.currentStep = 99;
      return this.renderGoodbye(state);
    } else {
      state.currentStep += 1;
      return this.renderStep(state);
    }
  }

  /**
   * Handles timeout (no input received within window)
   */
  static handleTimeout(state: CallSessionState): StepAction {
    state.questionRetryCount += 1;
    if (state.questionRetryCount > 2) {
      state.isCompleted = true;
      state.currentStep = -2;
      return {
        type: 'TERMINATE',
        promptCode: SYSTEM_PROMPTS.timeout.promptCode,
        teluguText: SYSTEM_PROMPTS.timeout.teluguText,
        englishText: SYSTEM_PROMPTS.timeout.englishText,
        expectedInputType: 'none',
        minDigits: 0,
        maxDigits: 0,
        finishOnKey: '',
        timeoutSeconds: 0,
        state,
      };
    }

    const currentDef = QUESTION_DEFINITIONS[state.currentStep] || QUESTION_DEFINITIONS[1];
    state.promptHistory.push(SYSTEM_PROMPTS.timeout.promptCode);

    return {
      type: 'PLAY_AND_GATHER',
      promptCode: currentDef.promptCode,
      teluguText: `${SYSTEM_PROMPTS.timeout.teluguText} ${currentDef.teluguText}`,
      englishText: `${SYSTEM_PROMPTS.timeout.englishText} ${currentDef.englishText}`,
      expectedInputType: currentDef.inputType,
      validDigits: currentDef.validDigits?.join(','),
      minDigits: currentDef.minDigits,
      maxDigits: currentDef.maxDigits,
      finishOnKey: currentDef.finishOnKey,
      timeoutSeconds: currentDef.timeoutSeconds,
      state,
    };
  }

  private static renderStep(state: CallSessionState): StepAction {
    const def = QUESTION_DEFINITIONS[state.currentStep];
    state.promptHistory.push(def.promptCode);

    return {
      type: 'PLAY_AND_GATHER',
      promptCode: def.promptCode,
      teluguText: def.teluguText,
      englishText: def.englishText,
      expectedInputType: def.inputType,
      validDigits: def.validDigits?.join(','),
      minDigits: def.minDigits,
      maxDigits: def.maxDigits,
      finishOnKey: def.finishOnKey,
      timeoutSeconds: def.timeoutSeconds,
      state,
    };
  }

  private static renderGoodbye(state: CallSessionState): StepAction {
    state.promptHistory.push(SYSTEM_PROMPTS.goodbye.promptCode);
    return {
      type: 'PLAY_AND_GATHER',
      promptCode: SYSTEM_PROMPTS.goodbye.promptCode,
      teluguText: SYSTEM_PROMPTS.goodbye.teluguText,
      englishText: SYSTEM_PROMPTS.goodbye.englishText,
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
    def: QuestionDefinition,
    rawDigits: string
  ): { isValid: boolean; parsedValue?: any } {
    const cleaned = rawDigits.replace(/#/g, '').trim();

    if (!cleaned) {
      return { isValid: false };
    }

    switch (def.code) {
      case 'intro':
        // Any single digit 0-9 is accepted
        return { isValid: /^[0-9]$/.test(cleaned), parsedValue: cleaned };

      case 'rain': {
        const rainMap: Record<string, string> = {
          '0': 'none',
          '1': 'light',
          '2': 'moderate',
          '3': 'heavy',
        };
        return rainMap[cleaned]
          ? { isValid: true, parsedValue: rainMap[cleaned] }
          : { isValid: false };
      }

      case 'irrigated': {
        if (cleaned === '1') return { isValid: true, parsedValue: 'yes' };
        if (cleaned === '2') return { isValid: true, parsedValue: 'no' };
        return { isValid: false };
      }

      case 'irrigation_count': {
        const count = parseInt(cleaned, 10);
        if (!isNaN(count) && count >= 1 && count <= 30) {
          return { isValid: true, parsedValue: count };
        }
        return { isValid: false };
      }

      case 'hours': {
        const hours = parseFloat(cleaned);
        // Note: 9 is 9 pump hours here!
        if (!isNaN(hours) && hours > 0 && hours <= 99) {
          return { isValid: true, parsedValue: hours };
        }
        return { isValid: false };
      }

      case 'crop_condition': {
        const condMap: Record<string, string> = {
          '1': 'good',
          '2': 'average',
          '3': 'poor',
        };
        return condMap[cleaned]
          ? { isValid: true, parsedValue: condMap[cleaned] }
          : { isValid: false };
      }

      case 'stage_confirmation': {
        if (cleaned === '1') return { isValid: true, parsedValue: 'confirmed' };
        if (cleaned === '2') return { isValid: true, parsedValue: 'divergent' };
        return { isValid: false };
      }

      case 'water_problem': {
        const wpMap: Record<string, string> = {
          '0': 'none',
          '1': 'shortage',
          '2': 'pump_power_issue',
          '3': 'source_depleted',
        };
        return wpMap[cleaned]
          ? { isValid: true, parsedValue: wpMap[cleaned] }
          : { isValid: false };
      }

      case 'crop_problem': {
        const cpMap: Record<string, string> = {
          '0': 'none',
          '1': 'pest_disease',
          '2': 'yellowing_drying',
          '3': 'other',
        };
        return cpMap[cleaned]
          ? { isValid: true, parsedValue: cpMap[cleaned] }
          : { isValid: false };
      }

      case 'callback_requested': {
        if (cleaned === '1') return { isValid: true, parsedValue: 'yes' };
        if (cleaned === '2') return { isValid: true, parsedValue: 'no' };
        return { isValid: false };
      }

      default:
        return { isValid: true, parsedValue: cleaned };
    }
  }

  /**
   * Transforms responses recorded by the state machine into a standardized CallCompletionPayload
   */
  static extractCompletionPayload(
    state: CallSessionState,
    cycleNumber: number
  ): CallCompletionPayload {
    const res = state.responses;

    const irrigated = res['irrigated']?.parsedValue === 'yes';
    const irrigationCount = irrigated ? Number(res['irrigation_count']?.parsedValue || 1) : 0;
    const hoursPerIrrigation = irrigated ? Number(res['hours']?.parsedValue || 0) : 0;

    return {
      seasonId: state.seasonId || '',
      farmerId: state.farmerId || '',
      cycleNumber,
      source: state.provider === 'simulator' ? 'simulator' : 'ivr',
      isSimulated: state.provider === 'simulator',
      rainfallCategory: (res['rain']?.parsedValue as any) || 'none',
      irrigated,
      irrigationCount,
      hoursPerIrrigation,
      cropCondition: (res['crop_condition']?.parsedValue as any) || 'good',
      stageConfirmed: res['stage_confirmation']?.parsedValue === 'confirmed',
      waterProblem: (res['water_problem']?.parsedValue as any) || 'none',
      cropProblem: (res['crop_problem']?.parsedValue as any) || 'none',
      callbackRequested: res['callback_requested']?.parsedValue === 'yes',
    };
  }
}
