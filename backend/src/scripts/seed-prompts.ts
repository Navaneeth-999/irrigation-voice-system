import { db } from '../db/index.js';
import {
  QUESTION_SPECS,
  buildPromptText,
  SYSTEM_VOICE_PROMPTS,
  ALERT_VOICE_PROMPTS,
} from '../modules/telephony/QuestionnaireConfig.js';

export async function seedQuestionnaire(txOrDb: any = db) {
  console.log('🎙️ Seeding Telugu questionnaire and audio prompts from single source of truth...');

  // 1. Create or get question set
  const setRes = await txOrDb.query(`
    INSERT INTO call_question_sets (code, name, language_code, version, description)
    VALUES (
      'TELUGU_FORTNIGHTLY_V1',
      'Telugu Fortnightly Irrigation Feedback (10 Questions + Voice Note)',
      'te',
      1,
      'Standard 10-step fortnightly voice call survey for Andhra Pradesh farmers with optional voice note'
    )
    ON CONFLICT (code) DO UPDATE SET updated_at = NOW()
    RETURNING id;
  `);

  const questionSetId = setRes.rows[0].id;

  // 2. Iterate through all question specifications
  for (const spec of Object.values(QUESTION_SPECS)) {
    const { teluguText, englishText } = buildPromptText(
      spec.basePromptTe,
      spec.basePromptEn,
      spec.options,
      spec.repeatKey
    );

    const validDigits = spec.options
      ? spec.options.map(o => o.digit).join(',')
      : spec.code === 'intro'
      ? '0,1,2,3,4,5,6,7,8,9'
      : spec.code === 'hours'
      ? '1-999'
      : spec.code === 'irrigation_count'
      ? '1-30'
      : null;

    const qRes = await txOrDb.query(`
      INSERT INTO call_questions (
        question_set_id, step_number, code, question_text_telugu, question_text_english,
        expected_input_type, valid_digits, min_digits, max_digits, finish_on_key,
        timeout_seconds, repeat_key, opt_out_key, skip_rule
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (question_set_id, step_number) DO UPDATE SET
        question_text_telugu = EXCLUDED.question_text_telugu,
        question_text_english = EXCLUDED.question_text_english,
        valid_digits = EXCLUDED.valid_digits,
        min_digits = EXCLUDED.min_digits,
        max_digits = EXCLUDED.max_digits,
        skip_rule = EXCLUDED.skip_rule,
        updated_at = NOW()
      RETURNING id;
    `, [
      questionSetId,
      spec.step,
      spec.code,
      teluguText,
      englishText,
      spec.inputType,
      validDigits,
      spec.minDigits,
      spec.maxDigits,
      spec.finishOnKey,
      spec.timeoutSeconds,
      spec.repeatKey,
      spec.optOutKey || null,
      spec.skipRule ? JSON.stringify(spec.skipRule) : null,
    ]);

    const questionId = qRes.rows[0].id;

    // Seed associated audio prompt
    await txOrDb.query(`
      INSERT INTO audio_prompts (
        question_id, prompt_code, language_code, prompt_type,
        text_content, english_meaning, audio_url, review_status
      )
      VALUES ($1, $2, 'te', 'question', $3, $4, $5, 'approved')
      ON CONFLICT (prompt_code) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        english_meaning = EXCLUDED.english_meaning,
        audio_url = EXCLUDED.audio_url,
        updated_at = NOW();
    `, [questionId, spec.promptCode, teluguText, englishText, spec.audioUrl || null]);
  }

  // 3. Insert System Prompts
  for (const [key, sp] of Object.entries(SYSTEM_VOICE_PROMPTS)) {
    await txOrDb.query(`
      INSERT INTO audio_prompts (
        question_id, prompt_code, language_code, prompt_type,
        text_content, english_meaning, audio_url, review_status
      )
      VALUES (NULL, $1, 'te', $2, $3, $4, $5, 'approved')
      ON CONFLICT (prompt_code) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        english_meaning = EXCLUDED.english_meaning,
        audio_url = EXCLUDED.audio_url,
        updated_at = NOW();
    `, [sp.promptCode, key, sp.teluguText, sp.englishText, sp.audioUrl || null]);
  }

  // 4. Insert Weather Alert Prompts
  for (const [alertType, ap] of Object.entries(ALERT_VOICE_PROMPTS)) {
    await txOrDb.query(`
      INSERT INTO audio_prompts (
        question_id, prompt_code, language_code, prompt_type,
        text_content, english_meaning, audio_url, review_status
      )
      VALUES (NULL, $1, 'te', 'alert', $2, $3, $4, 'approved')
      ON CONFLICT (prompt_code) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        english_meaning = EXCLUDED.english_meaning,
        audio_url = EXCLUDED.audio_url,
        updated_at = NOW();
    `, [ap.promptCode, ap.teluguText, ap.englishText, ap.audioUrl || null]);
  }

  console.log('✅ Telugu questionnaire & audio prompts successfully seeded.');
}
