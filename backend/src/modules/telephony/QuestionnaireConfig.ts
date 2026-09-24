/**
 * QuestionnaireConfig.ts
 * Single source of truth for all questionnaire steps, digit mappings,
 * and bilingual Telugu/English prompt text.
 */

export interface OptionMapping {
  digit: string;
  value: string;
  labelTe: string;
  labelEn: string;
}

export interface QuestionSpec {
  step: number;
  code: string;
  promptCode: string;
  titleEn: string;
  titleTe: string;
  basePromptTe: string;
  basePromptEn: string;
  inputType: 'single_digit' | 'multi_digit' | 'voice_recording';
  minDigits: number;
  maxDigits: number;
  finishOnKey: string;
  timeoutSeconds: number;
  repeatKey: string;
  optOutKey?: string;
  audioUrl?: string;
  options?: OptionMapping[];
  skipRule?: { dependsOn: string; skipIfValue: string; skipToStep: number };
}

// 1. Single Source of Truth for Options
export const QUESTION_OPTIONS: Record<string, OptionMapping[]> = {
  rain: [
    { digit: '1', value: 'none', labelTe: 'వర్షం లేకపోతే 1', labelEn: '1 for none' },
    { digit: '2', value: 'light', labelTe: 'స్వల్ప వర్షం అయితే 2', labelEn: '2 for light' },
    { digit: '3', value: 'moderate', labelTe: 'మోస్తరు వర్షం అయితే 3', labelEn: '3 for moderate' },
    { digit: '4', value: 'heavy', labelTe: 'భారీ వర్షం అయితే 4', labelEn: '4 for heavy' },
  ],
  irrigated: [
    { digit: '1', value: 'yes', labelTe: 'అవును అయితే 1', labelEn: '1 for Yes' },
    { digit: '2', value: 'no', labelTe: 'లేదు అయితే 2', labelEn: '2 for No' },
  ],
  crop_condition: [
    { digit: '1', value: 'good', labelTe: 'బాగుంటే 1', labelEn: '1 for Good' },
    { digit: '2', value: 'average', labelTe: 'సాధారణంగా ఉంటే 2', labelEn: '2 for Average' },
    { digit: '3', value: 'poor', labelTe: 'బాగోలేకపోతే 3', labelEn: '3 for Poor' },
  ],
  stage_confirmation: [
    { digit: '1', value: 'confirmed', labelTe: 'అవును అయితే 1', labelEn: '1 for Yes' },
    { digit: '2', value: 'different', labelTe: 'వేరే దశ అయితే 2', labelEn: '2 for Different' },
  ],
  water_problem: [
    { digit: '1', value: 'none', labelTe: 'సమస్య లేకపోతే 1', labelEn: '1 for none' },
    { digit: '2', value: 'shortage', labelTe: 'నీటి కొరత అయితే 2', labelEn: '2 for shortage' },
    { digit: '3', value: 'pump_power', labelTe: 'మోటార్ లేదా కరెంట్ సమస్య అయితే 3', labelEn: '3 for pump or power issue' },
    { digit: '4', value: 'source_unavailable', labelTe: 'నీటి వనరు ఎండిపోతే 4', labelEn: '4 for source unavailable' },
  ],
  crop_problem: [
    { digit: '1', value: 'none', labelTe: 'సమస్య లేకపోతే 1', labelEn: '1 for none' },
    { digit: '2', value: 'pests_disease', labelTe: 'తెగుళ్లు లేదా పురుగు అయితే 2', labelEn: '2 for pests or disease' },
    { digit: '3', value: 'yellowing_drying', labelTe: 'ఆకులు పసుపుపచ్చగా మారడం లేదా ఎండిపోవడం అయితే 3', labelEn: '3 for yellowing or drying' },
    { digit: '4', value: 'other', labelTe: 'ఇతర సమస్య అయితే 4', labelEn: '4 for other issues' },
  ],
  callback_requested: [
    { digit: '1', value: 'yes', labelTe: 'అవును అయితే 1', labelEn: '1 for Yes' },
    { digit: '2', value: 'no', labelTe: 'లేదు అయితే 2', labelEn: '2 for No' },
  ],
};

// Crop Stage Options (Default Paddy/Rice stages; extensible per crop)
export const CROP_STAGE_OPTIONS: Record<string, OptionMapping[]> = {
  paddy: [
    { digit: '1', value: 'nursery_land_prep', labelTe: 'నారుమడి మరియు దమ్ము చేయడం అయితే 1', labelEn: '1 for Nursery & Land Preparation' },
    { digit: '2', value: 'tillering_vegetative', labelTe: 'పిలకలు వేసే దశ అయితే 2', labelEn: '2 for Vegetative & Tillering' },
    { digit: '3', value: 'flowering_reproductive', labelTe: 'చిరుపొట్ట మరియు పూత దశ అయితే 3', labelEn: '3 for Flowering & Reproductive' },
    { digit: '4', value: 'maturation_harvest', labelTe: 'గింజ పాలుపోసుకునే మరియు కోత దశ అయితే 4', labelEn: '4 for Ripening & Maturation' },
  ],
};

// Helper: Generates full prompt text ensuring 100% agreement between options and text
export function buildPromptText(
  baseTe: string,
  baseEn: string,
  options?: OptionMapping[],
  repeatKey: string = '*'
): { teluguText: string; englishText: string } {
  if (!options || options.length === 0) {
    return {
      teluguText: baseTe,
      englishText: baseEn,
    };
  }

  const teOptions = options.map(o => o.labelTe).join(', ');
  const enOptions = options.map(o => o.labelEn).join(', ');

  const teluguText = `${baseTe} ${teOptions} నొక్కండి. పునరావృతం చేయడానికి ${repeatKey} నొక్కండి.`;
  const englishText = `${baseEn} Press ${enOptions}. Press ${repeatKey} to repeat.`;

  return { teluguText, englishText };
}

// 2. Full Questionnaire Specifications
export const QUESTION_SPECS: Record<number, QuestionSpec> = {
  1: {
    step: 1,
    code: 'intro',
    promptCode: 'prompt_intro_te',
    titleEn: 'Call Introduction & Opt-Out Notice',
    titleTe: 'కాల్ పరిచయం మరియు నిలిపివేత వివరాలు',
    basePromptTe: 'నమస్కారం! మీ పంట నీటిపారుదల సమాచారం కొరకు ఈ కాల్. కాల్ కొనసాగించడానికి ఏదైనా అంకె నొక్కండి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి.',
    basePromptEn: 'Greeting! This call is to collect irrigation feedback for your crop. Press any key to continue. Press 9 to stop receiving calls.',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    optOutKey: '9',
    audioUrl: '/storage/audio/prompts/intro_te.mp3',
  },
  2: {
    step: 2,
    code: 'rain',
    promptCode: 'prompt_rain_te',
    titleEn: 'Rainfall in last 14 days',
    titleTe: 'గత 14 రోజులలో వర్షపాతం',
    basePromptTe: 'గత 14 రోజులలో మీ పొలంలో వర్షం ఎలా కురిసింది?',
    basePromptEn: 'How was the rainfall in your field over the last 14 days?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.rain,
    audioUrl: '/storage/audio/prompts/rain_te.mp3',
  },
  3: {
    step: 3,
    code: 'irrigated',
    promptCode: 'prompt_irrigated_te',
    titleEn: 'Field Irrigated Confirmation',
    titleTe: 'నీరు పెట్టిన వివరాల ధృవీకరణ',
    basePromptTe: 'గత 14 రోజులలో మీరు పొలానికి నీరు పెట్టారా?',
    basePromptEn: 'Did you irrigate your field in the last 14 days?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.irrigated,
    skipRule: { dependsOn: 'irrigated', skipIfValue: '2', skipToStep: 6 },
    audioUrl: '/storage/audio/prompts/irrigated_te.mp3',
  },
  4: {
    step: 4,
    code: 'irrigation_count',
    promptCode: 'prompt_irrigation_count_te',
    titleEn: 'Irrigation Count in Fortnight (1-2 digits + #)',
    titleTe: 'తడుల సంఖ్య',
    basePromptTe: 'గత 14 రోజులలో మొత్తం ఎన్ని సార్లు నీరు పెట్టారు? సంఖ్యను నొక్కి # నొక్కండి. పునరావృతం చేయడానికి * నొక్కండి.',
    basePromptEn: 'How many times did you irrigate in total over the last 14 days? Enter 1 or 2 digits and press #. Press * to repeat.',
    inputType: 'multi_digit',
    minDigits: 1,
    maxDigits: 2,
    finishOnKey: '#',
    timeoutSeconds: 6,
    repeatKey: '*',
    audioUrl: '/storage/audio/prompts/irrigation_count_te.mp3',
  },
  5: {
    step: 5,
    code: 'hours',
    promptCode: 'prompt_hours_te',
    titleEn: 'Total Running Hours in Fortnight (1-3 digits + #)',
    titleTe: 'మొత్తం మోటార్ నడిపిన గంటలు',
    basePromptTe: 'గత 14 రోజులలో మొత్తం ఎన్ని గంటలు మోటార్ నడిపారు? గంటల సంఖ్యను నొక్కి # నొక్కండి. పునరావృతం చేయడానికి * నొక్కండి.',
    basePromptEn: 'In total, how many hours did the pump run over the last 14 days? Enter 1 to 3 digits and press #. Press * to repeat.',
    inputType: 'multi_digit',
    minDigits: 1,
    maxDigits: 3,
    finishOnKey: '#',
    timeoutSeconds: 7,
    repeatKey: '*',
    audioUrl: '/storage/audio/prompts/hours_te.mp3',
  },
  6: {
    step: 6,
    code: 'crop_condition',
    promptCode: 'prompt_crop_condition_te',
    titleEn: 'Crop Condition Rating',
    titleTe: 'పంట పరిస్థితి',
    basePromptTe: 'మీ ప్రస్తుత పంట పరిస్థితి ఎలా ఉంది?',
    basePromptEn: 'How is your current crop condition?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.crop_condition,
    audioUrl: '/storage/audio/prompts/crop_condition_te.mp3',
  },
  7: {
    step: 7,
    code: 'stage_confirmation',
    promptCode: 'prompt_stage_confirmation_te',
    titleEn: 'Expected Crop Stage Confirmation',
    titleTe: 'పంట ఎదుగుదల దశ ధృవీకరణ',
    basePromptTe: 'వ్యవసాయ రికార్డుల ప్రకారం మీ పంట ప్రస్తుతం ఎదుగుదల దశలో ఉంది. ఇది సరైనదేనా?',
    basePromptEn: 'According to agricultural records, your crop is in the expected stage. Is this correct?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.stage_confirmation,
    audioUrl: '/storage/audio/prompts/stage_confirmation_te.mp3',
  },
  // Sub-step 7b for when stage_confirmation == 2 (different)
  72: {
    step: 72,
    code: 'reported_stage_select',
    promptCode: 'prompt_reported_stage_select_te',
    titleEn: 'Select Current Crop Growth Stage',
    titleTe: 'ప్రస్తుత పంట దశను ఎంచుకోండి',
    basePromptTe: 'మీ పంట ప్రస్తుత దశను ఎంచుకోండి:',
    basePromptEn: 'Select your crop’s current stage:',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 6,
    repeatKey: '*',
    options: CROP_STAGE_OPTIONS.paddy,
    audioUrl: '/storage/audio/prompts/reported_stage_select_te.mp3',
  },
  8: {
    step: 8,
    code: 'water_problem',
    promptCode: 'prompt_water_problem_te',
    titleEn: 'Water Availability Problems',
    titleTe: 'నీటి లభ్యత సమస్యలు',
    basePromptTe: 'నీటి లభ్యతలో ఏమైనా సమస్య ఉందా?',
    basePromptEn: 'Did you experience any water availability problems?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.water_problem,
    audioUrl: '/storage/audio/prompts/water_problem_te.mp3',
  },
  9: {
    step: 9,
    code: 'crop_problem',
    promptCode: 'prompt_crop_problem_te',
    titleEn: 'Pest or Crop Health Problems',
    titleTe: 'తెగుళ్లు లేదా ఇతర పంట సమస్యలు',
    basePromptTe: 'పంటలో ఏమైనా ఇతర సమస్యలు ఉన్నాయా?',
    basePromptEn: 'Did you observe any pests or crop health problems?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.crop_problem,
    audioUrl: '/storage/audio/prompts/crop_problem_te.mp3',
  },
  10: {
    step: 10,
    code: 'callback_requested',
    promptCode: 'prompt_callback_requested_te',
    titleEn: 'Field Officer Callback Request',
    titleTe: 'వ్యవసాయ అధికారి లేదా వాలంటీర్ సంప్రదింపు అభ్యర్థన',
    basePromptTe: 'వ్యవసాయ అధికారి లేదా వాలంటీర్ మిమ్మల్ని ఫోన్ ద్వారా సంప్రదించాలని కోరుకుంటున్నారా?',
    basePromptEn: 'Would you like an agricultural officer or volunteer to call you back?',
    inputType: 'single_digit',
    minDigits: 1,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    options: QUESTION_OPTIONS.callback_requested,
    audioUrl: '/storage/audio/prompts/callback_requested_te.mp3',
  },
  11: {
    step: 11,
    code: 'voice_note',
    promptCode: 'prompt_voice_note_te',
    titleEn: 'Optional 30-Second Voice Message Recording',
    titleTe: 'ఐచ్ఛిక 30-సెకన్ల వాయిస్ రికార్డింగ్',
    basePromptTe: 'మీకు ఇంకా ఏమైనా అదనపు సమాచారం లేదా సందేశం ఉంటే, బీప్ శబ్దం తర్వాత 30 సెకన్ల వరకు మాట్లాడి # నొక్కండి లేదా కాల్ ముగించండి. సందేశం లేకపోతే 1 నొక్కండి.',
    basePromptEn: 'If you have any additional message or feedback, record your voice message after the beep for up to 30 seconds, then press # or hang up. If no message, press 1.',
    inputType: 'voice_recording',
    minDigits: 0,
    maxDigits: 1,
    finishOnKey: '#',
    timeoutSeconds: 5,
    repeatKey: '*',
    audioUrl: '/storage/audio/prompts/voice_note_te.mp3',
  },
};

export const SYSTEM_VOICE_PROMPTS = {
  invalid_input: {
    promptCode: 'prompt_invalid_input_te',
    teluguText: 'క్షమించండి, మీరు నొక్కిన అంకె సరికాదు. దయచేసి సరైన అంకెను మళ్ళీ నొక్కండి.',
    englishText: 'Sorry, that was not a valid entry. Please try again.',
    audioUrl: '/storage/audio/prompts/invalid_input_te.mp3',
  },
  timeout: {
    promptCode: 'prompt_timeout_te',
    teluguText: 'సమాధానం అందలేదు. దయచేసి అంకెను నొక్కండి.',
    englishText: 'We did not receive a response. Please press a key.',
    audioUrl: '/storage/audio/prompts/timeout_te.mp3',
  },
  opt_out_confirm: {
    promptCode: 'prompt_opt_out_confirm_te',
    teluguText: 'మీ అభ్యర్థన మేరకు భవిష్యత్తులో ఈ నంబర్‌కు ఆటోమేటిక్ కాల్స్ నిలిపివేయబడ్డాయి. ధన్యవాదాలు.',
    englishText: 'Per your request, automated calls to this number have been stopped. Thank you.',
    audioUrl: '/storage/audio/prompts/opt_out_confirm_te.mp3',
  },
  goodbye: {
    promptCode: 'prompt_goodbye_te',
    teluguText: 'మీ అమూల్యమైన సమాచారానికి ధన్యవాదాలు. మీ వివరాలు నమోదు చేయబడ్డాయి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి. శుభం!',
    englishText: 'Thank you for your valuable information. Your feedback is recorded. Press 9 to opt out of future calls. Goodbye!',
    audioUrl: '/storage/audio/prompts/goodbye_te.mp3',
  },
};
