import { db, withTransaction } from '../db/index.js';

export async function seedQuestionnaire(txOrDb: any = db) {
  console.log('🎙️ Seeding Telugu questionnaire and audio prompts...');

  // 1. Create or get question set
  const setRes = await txOrDb.query(`
    INSERT INTO call_question_sets (code, name, language_code, version, description)
    VALUES (
      'TELUGU_FORTNIGHTLY_V1',
      'Telugu Fortnightly Irrigation Feedback (10 Questions)',
      'te',
      1,
      'Standard 10-step fortnightly voice call survey for Andhra Pradesh farmers'
    )
    ON CONFLICT (code) DO UPDATE SET updated_at = NOW()
    RETURNING id;
  `);

  const questionSetId = setRes.rows[0].id;

  // 2. Define 10 Questions
  const questions = [
    {
      step: 1,
      code: 'intro',
      telugu: 'నమస్కారం! మీ పంట నీటిపారుదల సమాచారం కొరకు ఈ కాల్. కాల్ కొనసాగించడానికి ఏదైనా అంకె నొక్కండి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి.',
      english: 'Greeting! This call is to collect irrigation feedback for your crop. Press any key to continue. Press 9 to stop receiving calls.',
      type: 'single_digit',
      valid_digits: '0,1,2,3,4,5,6,7,8,9',
      min_digits: 1,
      max_digits: 1,
      opt_out: '9',
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 2,
      code: 'rain',
      telugu: 'గత 14 రోజులలో మీ పొలంలో వర్షం ఎలా కురిసింది? వర్షం లేకపోతే 0, స్వల్ప వర్షం అయితే 1, మోస్తరు వర్షం అయితే 2, భారీ వర్షం అయితే 3 నొక్కండి. పునరావృతం చేయడానికి * నొక్కండి.',
      english: 'How was the rainfall in your field over the last 14 days? Press 0 for none, 1 for light, 2 for moderate, 3 for heavy. Press * to repeat.',
      type: 'single_digit',
      valid_digits: '0,1,2,3',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 3,
      code: 'irrigated',
      telugu: 'గత 14 రోజులలో మీరు పొలానికి నీరు పెట్టారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి.',
      english: 'Did you irrigate your field in the last 14 days? Press 1 for Yes, 2 for No.',
      type: 'single_digit',
      valid_digits: '1,2',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: { depends_on: 'irrigated', skip_if_value: '2', skip_to_step: 6 },
    },
    {
      step: 4,
      code: 'irrigation_count',
      telugu: 'గత 14 రోజులలో ఎన్ని సార్లు నీరు పెట్టారు? సంఖ్యను నొక్కి # నొక్కండి.',
      english: 'How many times did you irrigate in the last 14 days? Enter number and press #.',
      type: 'multi_digit',
      valid_digits: '1-30',
      min_digits: 1,
      max_digits: 2,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 5,
      code: 'hours',
      telugu: 'ఒక్కో తడికి సగటున మోటార్ ఎన్ని గంటలు నడిపారు? గంటల సంఖ్యను నొక్కి # నొక్కండి.',
      english: 'On average, how many hours did the pump run per irrigation? Enter hours and press #.',
      type: 'multi_digit',
      valid_digits: '1-99',
      min_digits: 1,
      max_digits: 2,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 6,
      code: 'crop_condition',
      telugu: 'మీ ప్రస్తుత పంట పరిస్థితి ఎలా ఉంది? బాగుంటే 1, సాధారణంగా ఉంటే 2, బాగోలేకపోతే 3 నొక్కండి.',
      english: 'How is your current crop condition? Press 1 for Good, 2 for Average, 3 for Poor.',
      type: 'single_digit',
      valid_digits: '1,2,3',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 7,
      code: 'stage_confirmation',
      telugu: 'వ్యవసాయ శాఖ అంచనా ప్రకారం మీ పంట ప్రస్తుతం పెరుగుదల దశలో ఉంది. ఇది సరైనదేనా? అవును అయితే 1, కాదు అయితే 2 నొక్కండి.',
      english: 'According to records, your crop is currently in the expected stage. Is this correct? Press 1 for Yes, 2 for No.',
      type: 'single_digit',
      valid_digits: '1,2',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 8,
      code: 'water_problem',
      telugu: 'నీటి లభ్యతలో ఏమైనా సమస్య ఉందా? సమస్య లేకపోతే 0, నీటి కొరత అయితే 1, మోటార్ లేదా కరెంట్ సమస్య అయితే 2, నీటి వనరు ఎండిపోతే 3 నొక్కండి.',
      english: 'Any water problems? 0 for none, 1 for shortage, 2 for motor/power issue, 3 for source dried up.',
      type: 'single_digit',
      valid_digits: '0,1,2,3',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 9,
      code: 'crop_problem',
      telugu: 'పంటలో ఏమైనా ఇతర సమస్యలు ఉన్నాయా? సమస్య లేకపోతే 0, తెగుళ్లు లేదా పురుగు అయితే 1, ఆకులు పసుపుపచ్చగా మారడం లేదా ఎండిపోవడం అయితే 2, ఇతర సమస్య అయితే 3 నొక్కండి.',
      english: 'Any crop problems? 0 for none, 1 for pests/disease, 2 for yellowing/drying, 3 for other issues.',
      type: 'single_digit',
      valid_digits: '0,1,2,3',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
    {
      step: 10,
      code: 'callback_requested',
      telugu: 'వ్యవసాయ అధికారి లేదా వాలంటీర్ మీతో మాట్లాడాలని కోరుకుంటున్నారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి.',
      english: 'Would you like an agricultural officer or volunteer to call you back? Press 1 for Yes, 2 for No.',
      type: 'single_digit',
      valid_digits: '1,2',
      min_digits: 1,
      max_digits: 1,
      opt_out: null,
      repeat_key: '*',
      skip_rule: null,
    },
  ];

  for (const q of questions) {
    const qRes = await txOrDb.query(`
      INSERT INTO call_questions (
        question_set_id, step_number, code, question_text_telugu, question_text_english,
        expected_input_type, valid_digits, min_digits, max_digits, finish_on_key,
        timeout_seconds, repeat_key, opt_out_key, skip_rule
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '#', 5, $10, $11, $12)
      ON CONFLICT (question_set_id, step_number) DO UPDATE SET
        question_text_telugu = EXCLUDED.question_text_telugu,
        question_text_english = EXCLUDED.question_text_english,
        valid_digits = EXCLUDED.valid_digits,
        skip_rule = EXCLUDED.skip_rule,
        updated_at = NOW()
      RETURNING id;
    `, [
      questionSetId, q.step, q.code, q.telugu, q.english,
      q.type, q.valid_digits, q.min_digits, q.max_digits,
      q.repeat_key, q.opt_out, q.skip_rule ? JSON.stringify(q.skip_rule) : null
    ]);

    const questionId = qRes.rows[0].id;

    // Insert associated question prompt
    await txOrDb.query(`
      INSERT INTO audio_prompts (
        question_id, prompt_code, language_code, prompt_type,
        text_content, english_meaning, review_status
      )
      VALUES ($1, $2, 'te', 'question', $3, $4, 'approved')
      ON CONFLICT (prompt_code) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        english_meaning = EXCLUDED.english_meaning,
        updated_at = NOW();
    `, [questionId, `prompt_${q.code}_te`, q.telugu, q.english]);
  }

  // 3. Insert System Voice Prompts (Invalid Input, Timeout, Opt-out Confirm, Goodbye)
  const systemPrompts = [
    {
      code: 'prompt_invalid_input_te',
      type: 'invalid_input',
      telugu: 'క్షమించండి, మీరు నొక్కిన అంకె సరికాదు. దయచేసి సరైన అంకెను మళ్ళీ నొక్కండి.',
      english: 'Sorry, that was not a valid entry. Please try again.',
    },
    {
      code: 'prompt_timeout_te',
      type: 'timeout',
      telugu: 'సమాధానం అందలేదు. దయచేసి అంకెను నొక్కండి.',
      english: 'We did not receive a response. Please press a key.',
    },
    {
      code: 'prompt_opt_out_confirm_te',
      type: 'opt_out_confirm',
      telugu: 'మీ అభ్యర్థన మేరకు భవిష్యత్తులో ఈ నంబర్‌కు ఆటోమేటిక్ కాల్స్ నిలిపివేయబడ్డాయి. ధన్యవాదాలు.',
      english: 'Per your request, automated calls to this number have been stopped. Thank you.',
    },
    {
      code: 'prompt_goodbye_te',
      type: 'goodbye',
      telugu: 'మీ అమూల్యమైన సమాచారానికి ధన్యవాదాలు. మీ వివరాలు నమోదు చేయబడ్డాయి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి. శుభం!',
      english: 'Thank you for your valuable information. Your feedback is recorded. Press 9 to opt out of future calls. Goodbye!',
    },
  ];

  for (const sp of systemPrompts) {
    await txOrDb.query(`
      INSERT INTO audio_prompts (
        question_id, prompt_code, language_code, prompt_type,
        text_content, english_meaning, review_status
      )
      VALUES (NULL, $1, 'te', $2, $3, $4, 'approved')
      ON CONFLICT (prompt_code) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        english_meaning = EXCLUDED.english_meaning,
        updated_at = NOW();
    `, [sp.code, sp.type, sp.telugu, sp.english]);
  }

  console.log('✅ Telugu questionnaire & audio prompts seeded successfully.');
}
