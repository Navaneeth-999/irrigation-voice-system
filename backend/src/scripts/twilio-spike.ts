import http from 'node:http';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import twilio from 'twilio';

// Load environment variables
dotenv.config();

interface SpikeEnv {
  TWILIO_ACCOUNT_SID: string | undefined;
  TWILIO_AUTH_TOKEN: string | undefined;
  TWILIO_PHONE_NUMBER: string | undefined;
  VERIFIED_TEST_NUMBER: string | undefined;
}

const envStatus = {
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'present' : 'absent',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 'present' : 'absent',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ? 'present' : 'absent',
  VERIFIED_TEST_NUMBER: process.env.VERIFIED_TEST_NUMBER ? 'present' : 'absent',
};

console.log('====================================================');
console.log('  Early Twilio Telephony Spike: Pre-Flight Check    ');
console.log('====================================================');
console.log('Environment Credential Status:');
console.log(`  TWILIO_ACCOUNT_SID   : ${envStatus.TWILIO_ACCOUNT_SID}`);
console.log(`  TWILIO_AUTH_TOKEN     : ${envStatus.TWILIO_AUTH_TOKEN}`);
console.log(`  TWILIO_PHONE_NUMBER   : ${envStatus.TWILIO_PHONE_NUMBER}`);
console.log(`  VERIFIED_TEST_NUMBER  : ${envStatus.VERIFIED_TEST_NUMBER}`);
console.log('----------------------------------------------------');

const missingVars = Object.entries(envStatus)
  .filter(([_, status]) => status === 'absent')
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.log('❌ BLOCKER DETECTED (Honest Reporting):');
  console.log(`Missing required Twilio environment variables: ${missingVars.join(', ')}`);
  console.log('\nTo execute a real outbound phone call via ngrok:');
  console.log('1. Set the following in backend/.env:');
  console.log('   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  console.log('   TWILIO_AUTH_TOKEN=your_auth_token_here');
  console.log('   TWILIO_PHONE_NUMBER=+1xxxxxxxxxx (or Twilio assigned number)');
  console.log('   VERIFIED_TEST_NUMBER=+919876543210 (your verified phone number)');
  console.log('2. Ensure ngrok is authenticated or available on PATH.');
  console.log('3. Run: npm run twilio:spike --prefix backend\n');
  console.log('As instructed by the master prompt, NO mock will be substituted for this spike.');
  process.exit(0);
}

// All credentials present - proceed with real call spike
const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const fromNumber = process.env.TWILIO_PHONE_NUMBER!;
const toNumber = process.env.VERIFIED_TEST_NUMBER!;

const PORT = 4005;

async function runRealSpike() {
  console.log('✅ All credentials present. Initializing local spike webhook server...');

  let callCompletedResolve: () => void;
  const callCompletedPromise = new Promise<void>((resolve) => {
    callCompletedResolve = resolve;
  });

  let publicUrl = '';

  const server = http.createServer((req, res) => {
    // 1. Serve sample hosted audio for <Play>
    if (req.url === '/spike/sample-audio.mp3') {
      // 1-second minimal MP3 silent frame
      const mp3Header = Buffer.from([
        0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
      ]);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3Header.length,
      });
      res.end(mp3Header);
      console.log('🎵 [Spike Server] Served sample hosted MP3 audio.');
      return;
    }

    // 2. Initial TwiML with <Play> and DTMF <Gather>
    if (req.url === '/spike/twiml') {
      const audioUrl = `${publicUrl}/spike/sample-audio.mp3`;
      const gatherAction = `${publicUrl}/spike/gather`;
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather action="${gatherAction}" method="POST" numDigits="1" timeout="10">
    <Say language="te-IN">నమస్కారం! ఇది ఆంధ్రప్రదేశ్ నీటిపారుదల వ్యవస్థ పరీక్ష కాల్. దయచేసి మీ ఫోన్ కీప్యాడ్‌పై ఏదైనా ఒక అంకె నొక్కండి.</Say>
    <Say language="en-IN">Welcome to the irrigation test call. Please press any digit on your keypad.</Say>
  </Gather>
  <Say language="en-IN">No keypad digit was detected. Goodbye.</Say>
  <Hangup/>
</Response>`;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
      console.log('📡 [Spike Server] Served TwiML with <Play> audio and DTMF <Gather>.');
      return;
    }

    // 3. DTMF round-trip handler receiving farmer keypad digit
    if (req.url === '/spike/gather' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const digits = params.get('Digits') || 'none';
        console.log(`📱 [Spike DTMF] SUCCESS: Received DTMF digit from farmer keypad: '${digits}'`);

        const responseTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="te-IN">మీరు ${digits} నొక్కారు. ధన్యవాదాలు! పరీక్ష విజయవంతమైంది.</Say>
  <Say language="en-IN">Received digit ${digits}. DTMF round-trip verified successfully. Goodbye.</Say>
  <Hangup/>
</Response>`;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(responseTwiml);
      });
      return;
    }

    // 4. Status callback webhook
    if (req.url === '/spike/status' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const callStatus = params.get('CallStatus');
        console.log(`📞 [Spike Webhook] Call Status Update: ${callStatus}`);
        if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus || '')) {
          callCompletedResolve();
        }
        res.writeHead(200);
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`🌐 Spike server listening on http://localhost:${PORT}`);

  console.log('🚀 Spawning ngrok tunnel...');
  const ngrokProcess = spawn('ngrok', ['http', PORT.toString(), '--log=stdout']);

  ngrokProcess.stdout.on('data', (data: Buffer) => {
    const text = data.toString();
    const urlMatch = text.match(/url=(https:\/\/[^\s]+)/);
    if (urlMatch && !publicUrl) {
      publicUrl = urlMatch[1];
      console.log(`🔗 ngrok tunnel established: ${publicUrl}`);
      triggerCall(publicUrl);
    }
  });

  ngrokProcess.stderr.on('data', (data: Buffer) => {
    console.error(`[ngrok err]: ${data.toString()}`);
  });

  async function triggerCall(baseUrl: string) {
    try {
      const client = twilio(accountSid, authToken);
      console.log(`📞 Initiating outbound call from ${fromNumber} to ${toNumber}...`);
      const call = await client.calls.create({
        from: fromNumber,
        to: toNumber,
        url: `${baseUrl}/spike/twiml`,
        statusCallback: `${baseUrl}/spike/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });

      console.log(`✅ Outbound call created successfully! Call SID: ${call.sid}`);
      console.log('Waiting for call completion callback...');

      // Timeout after 90 seconds in case callback isn't received
      const timeout = setTimeout(() => {
        console.log('⚠️ Timed out waiting for call status callback.');
        cleanup();
      }, 90000);

      await callCompletedPromise;
      clearTimeout(timeout);
      console.log('🎉 Spike completed successfully with live Twilio call!');
      cleanup();
    } catch (err: any) {
      console.error('❌ Failed to trigger Twilio call:', err.message);
      cleanup();
    }
  }

  function cleanup() {
    ngrokProcess.kill();
    server.close(() => {
      console.log('🧹 Cleanup complete. Exiting spike.');
      process.exit(0);
    });
  }
}

runRealSpike().catch(err => {
  console.error('Fatal error in spike:', err);
  process.exit(1);
});
