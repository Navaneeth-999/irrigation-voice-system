import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Volume2,
  Clock,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  User,
  MapPin,
  Sprout,
  HelpCircle,
  Play,
  ArrowRight,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';

interface SeasonOption {
  id: string;
  season_code: string;
  farmer_name: string;
  farmer_id: string;
  crop_name: string;
  village_name: string;
  status: string;
}

interface StepAction {
  type: 'PLAY_AND_GATHER' | 'TERMINATE';
  promptCode: string;
  teluguText: string;
  englishText: string;
  expectedInputType: string;
  validDigits?: string;
  minDigits: number;
  maxDigits: number;
  finishOnKey: string;
  timeoutSeconds: number;
  state: any;
}

interface AudioPrompt {
  id: string;
  prompt_code: string;
  prompt_type: string;
  text_content: string;
  english_meaning: string;
  review_status: 'draft' | 'recorded' | 'reviewed_agronomist' | 'approved' | 'rejected';
  reviewer_name?: string;
  review_notes?: string;
  step_number?: number;
}

export const CallSimulatorPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Active Seasons
  const { data: seasons = [] } = useQuery<SeasonOption[]>({
    queryKey: ['active-seasons'],
    queryFn: async () => {
      const res = await apiRequest<SeasonOption[]>('/seasons?status=active');
      return res || [];
    },
  });

  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('+919876543210');

  // Call Schedules for selected season
  const { data: schedules = [] } = useQuery<any[]>({
    queryKey: ['season-schedules', selectedSeasonId],
    queryFn: async () => {
      if (!selectedSeasonId) return [];
      const res = await apiRequest<any[]>(`/telephony/schedules?seasonId=${selectedSeasonId}`);
      return res || [];
    },
    enabled: !!selectedSeasonId,
  });

  // Audio Prompts
  const { data: prompts = [], refetch: refetchPrompts } = useQuery<AudioPrompt[]>({
    queryKey: ['audio-prompts'],
    queryFn: async () => {
      const res = await apiRequest<AudioPrompt[]>('/telephony/prompts');
      return res || [];
    },
  });

  // Call State
  const [callActive, setCallActive] = useState<boolean>(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'completed' | 'opted_out'>('idle');
  const [sessionId, setSessionId] = useState<string>('');
  const [currentAction, setCurrentAction] = useState<StepAction | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [inputBuffer, setInputBuffer] = useState<string>('');
  const [transcript, setTranscript] = useState<Array<{ sender: 'system' | 'user'; text: string; time: string }>>([]);
  const [activeTab, setActiveTab] = useState<'simulator' | 'prompts'>('simulator');
  const [reviewModalPrompt, setReviewModalPrompt] = useState<AudioPrompt | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>('approved');
  const [reviewNotes, setReviewNotes] = useState<string>('');

  // Auto-select first active season
  useEffect(() => {
    if (seasons.length > 0 && !selectedSeasonId) {
      setSelectedSeasonId(seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  // Call duration counter
  useEffect(() => {
    let interval: any;
    if (callActive && callStatus === 'connected') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callActive, callStatus]);

  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId);
  const nextDueSchedule = schedules.find((s) => s.status === 'scheduled') || schedules[0];

  // Start Call Mutation
  const startCallMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/telephony/simulator/start', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: selectedSeasonId,
          farmerId: selectedSeason?.farmer_id,
          scheduleId: nextDueSchedule?.id,
          phoneE164: phoneNumber,
        }),
      });
    },
    onSuccess: (data: any) => {
      setSessionId(data.sessionId);
      setCurrentAction(data.action);
      setCallActive(true);
      setCallStatus('connected');
      setTranscript([
        {
          sender: 'system',
          text: `[Audio Prompt: ${data.action.promptCode}] ${data.action.teluguText}`,
          time: new Date().toLocaleTimeString(),
        },
      ]);
    },
    onError: (err: any) => {
      alert(`Failed to start call: ${err.message}`);
    },
  });

  // Send DTMF Mutation
  const dtmfMutation = useMutation({
    mutationFn: async (digits: string) => {
      return await apiRequest('/telephony/simulator/dtmf', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          digits,
        }),
      });
    },
    onSuccess: (data: any) => {
      const action = data.action as StepAction;
      setCurrentAction(action);
      setInputBuffer('');

      setTranscript((prev) => [
        ...prev,
        {
          sender: 'system',
          text: `[Audio: ${action.promptCode}] ${action.teluguText}`,
          time: new Date().toLocaleTimeString(),
        },
      ]);

      if (action.type === 'TERMINATE') {
        setCallActive(false);
        if (action.state.isOptedOut) {
          setCallStatus('opted_out');
        } else {
          setCallStatus('completed');
        }
        queryClient.invalidateQueries({ queryKey: ['season-schedules'] });
        queryClient.invalidateQueries({ queryKey: ['season-details', selectedSeasonId] });
      }
    },
    onError: (err: any) => {
      alert(`DTMF error: ${err.message}`);
    },
  });

  // Timeout Mutation
  const timeoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/telephony/simulator/timeout', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
    },
    onSuccess: (data: any) => {
      const action = data.action as StepAction;
      setCurrentAction(action);
      setTranscript((prev) => [
        ...prev,
        {
          sender: 'system',
          text: `[Timeout Re-prompt] ${action.teluguText}`,
          time: new Date().toLocaleTimeString(),
        },
      ]);
      if (action.type === 'TERMINATE') {
        setCallActive(false);
        setCallStatus('completed');
      }
    },
  });

  // Prompt Review Mutation
  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!reviewModalPrompt) return;
      return await apiRequest(`/telephony/prompts/${reviewModalPrompt.prompt_code}/review`, {
        method: 'POST',
        body: JSON.stringify({
          status: reviewStatus,
          notes: reviewNotes,
        }),
      });
    },
    onSuccess: () => {
      setReviewModalPrompt(null);
      refetchPrompts();
    },
    onError: (err: any) => {
      alert(`Review update failed: ${err.message}`);
    },
  });

  const handleKeyPress = (key: string) => {
    if (!callActive) return;

    if (currentAction?.expectedInputType === 'multi_digit') {
      const newBuf = inputBuffer + key;
      setInputBuffer(newBuf);
      setTranscript((prev) => [
        ...prev,
        { sender: 'user', text: `Key Pressed: ${key} (Buffer: ${newBuf})`, time: new Date().toLocaleTimeString() },
      ]);
      if (key === '#') {
        dtmfMutation.mutate(newBuf);
      }
    } else {
      setTranscript((prev) => [
        ...prev,
        { sender: 'user', text: `Key Pressed: ${key}`, time: new Date().toLocaleTimeString() },
      ]);
      dtmfMutation.mutate(key);
    }
  };

  const handleHangup = () => {
    setCallActive(false);
    setCallStatus('idle');
    setTranscript((prev) => [
      ...prev,
      { sender: 'system', text: 'Call terminated by user.', time: new Date().toLocaleTimeString() },
    ]);
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-700/50 text-emerald-200 text-xs font-semibold uppercase tracking-wider mb-2">
              <PhoneCall className="w-3.5 h-3.5" />
              Telugu IVR Voice Engine & Interactive Simulator
            </div>
            <h1 className="text-2xl font-bold">Farmer Telephony Simulator</h1>
            <p className="text-emerald-100 text-sm mt-1 max-w-2xl">
              Simulate automated fortnightly outbound phone calls to Andhra Pradesh farmers in Telugu.
              Evaluate speech prompts, DTMF dialpad entries, skip branching rules, pump hours volume estimation, and downstream action items.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-emerald-950/40 p-1.5 rounded-xl border border-emerald-700/40">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'simulator'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              Interactive Simulator
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'prompts'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              Audio Prompts & Review ({prompts.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'simulator' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Phone Simulator Device (5 cols) */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-full max-w-md bg-stone-900 rounded-[2.5rem] p-4 shadow-2xl border-4 border-stone-700 flex flex-col">
              {/* Speaker / Camera Notch */}
              <div className="flex justify-between items-center px-4 py-1 mb-2">
                <span className="text-stone-400 text-xs font-mono font-medium">9:41 AM</span>
                <div className="w-20 h-4 bg-stone-800 rounded-full flex items-center justify-center">
                  <div className="w-3 h-3 bg-stone-900 rounded-full"></div>
                </div>
                <div className="flex items-center gap-1.5 text-stone-400 text-xs">
                  <span>5G</span>
                  <div className="w-4 h-2 border border-stone-400 rounded-sm bg-stone-300"></div>
                </div>
              </div>

              {/* Phone Screen Display */}
              <div className="bg-stone-950 rounded-3xl p-5 flex flex-col min-h-[380px] border border-stone-800 relative overflow-hidden">
                {/* Status Bar */}
                <div className="flex items-center justify-between border-b border-stone-800/80 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        callStatus === 'connected'
                          ? 'bg-emerald-500 animate-pulse'
                          : callStatus === 'opted_out'
                          ? 'bg-amber-500'
                          : callStatus === 'completed'
                          ? 'bg-teal-500'
                          : 'bg-stone-500'
                      }`}
                    ></span>
                    <span className="text-stone-300 text-xs font-semibold uppercase tracking-wider">
                      {callStatus === 'connected'
                        ? 'Call in Progress'
                        : callStatus === 'opted_out'
                        ? 'Opted Out'
                        : callStatus === 'completed'
                        ? 'Call Completed'
                        : 'Ready to Call'}
                    </span>
                  </div>
                  {callStatus === 'connected' && (
                    <span className="text-emerald-400 font-mono text-sm font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                      {formatTimer(callDuration)}
                    </span>
                  )}
                </div>

                {/* Farmer & Season Info Header */}
                <div className="text-center mb-3">
                  <h3 className="text-stone-100 font-bold text-lg">
                    {selectedSeason?.farmer_name || 'Select Farmer'}
                  </h3>
                  <p className="text-stone-400 text-xs">
                    {phoneNumber} &bull; {selectedSeason?.crop_name} ({selectedSeason?.village_name})
                  </p>
                </div>

                {/* Voice Prompt Area */}
                {callStatus === 'connected' && currentAction ? (
                  <div className="flex-1 flex flex-col justify-center space-y-3">
                    {/* Audio Animation Indicator */}
                    <div className="flex justify-center items-center gap-1.5 py-1">
                      <div className="w-1 bg-emerald-400 h-6 animate-pulse rounded-full"></div>
                      <div className="w-1 bg-emerald-400 h-10 animate-pulse delay-75 rounded-full"></div>
                      <div className="w-1 bg-emerald-400 h-4 animate-pulse delay-150 rounded-full"></div>
                      <div className="w-1 bg-emerald-400 h-8 animate-pulse delay-100 rounded-full"></div>
                      <div className="w-1 bg-emerald-400 h-5 animate-pulse delay-200 rounded-full"></div>
                      <span className="text-emerald-400 text-xs font-medium ml-2 flex items-center gap-1">
                        <Volume2 className="w-3.5 h-3.5" /> Speaking Telugu
                      </span>
                    </div>

                    {/* Step Badge */}
                    <div className="text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700/50">
                        Question Step {currentAction.state?.currentStep || 1}
                      </span>
                    </div>

                    {/* Telugu Text Display */}
                    <div className="bg-stone-900/90 p-3.5 rounded-xl border border-stone-800 text-center">
                      <p className="text-amber-300 font-medium text-base leading-relaxed tracking-wide">
                        {currentAction.teluguText}
                      </p>
                      <p className="text-stone-400 text-xs italic mt-2 border-t border-stone-800/80 pt-1.5">
                        {currentAction.englishText}
                      </p>
                    </div>

                    {/* Buffer for multi-digit */}
                    {currentAction.expectedInputType === 'multi_digit' && (
                      <div className="text-center text-xs text-stone-300 font-mono">
                        Entered: <span className="text-amber-400 font-bold text-sm">{inputBuffer || '_'}</span> (press # to finish)
                      </div>
                    )}
                  </div>
                ) : callStatus === 'completed' ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-2" />
                    <h4 className="text-emerald-300 font-bold text-base">Call Flow Completed!</h4>
                    <p className="text-stone-400 text-xs mt-1">
                      Responses logged and verified. Fortnightly feedback, irrigation estimate, and action items recorded.
                    </p>
                  </div>
                ) : callStatus === 'opted_out' ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                    <AlertTriangle className="w-12 h-12 text-amber-400 mb-2" />
                    <h4 className="text-amber-300 font-bold text-base">Farmer Opted Out</h4>
                    <p className="text-stone-400 text-xs mt-1">
                      Farmer pressed 9. Automated calls to this contact number have been stopped.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-stone-500">
                    <Phone className="w-10 h-10 mb-2 opacity-40" />
                    <p className="text-xs">Press the green Call button below to initiate simulated IVR call.</p>
                  </div>
                )}
              </div>

              {/* Physical Keypad Buttons */}
              <div className="mt-4 px-3">
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { key: '1', sub: '' },
                    { key: '2', sub: 'ABC' },
                    { key: '3', sub: 'DEF' },
                    { key: '4', sub: 'GHI' },
                    { key: '5', sub: 'JKL' },
                    { key: '6', sub: 'MNO' },
                    { key: '7', sub: 'PQRS' },
                    { key: '8', sub: 'TUV' },
                    { key: '9', sub: 'WXYZ' },
                    { key: '*', sub: 'Repeat' },
                    { key: '0', sub: '+' },
                    { key: '#', sub: 'Finish' },
                  ].map((btn) => (
                    <button
                      key={btn.key}
                      onClick={() => handleKeyPress(btn.key)}
                      disabled={!callActive}
                      className={`h-12 rounded-xl flex flex-col items-center justify-center font-bold text-lg transition ${
                        callActive
                          ? 'bg-stone-800 text-white hover:bg-stone-700 active:bg-emerald-600 active:scale-95 shadow-sm'
                          : 'bg-stone-800/40 text-stone-600 cursor-not-allowed'
                      }`}
                    >
                      <span>{btn.key}</span>
                      {btn.sub && <span className="text-[9px] text-stone-400 font-normal uppercase -mt-1">{btn.sub}</span>}
                    </button>
                  ))}
                </div>

                {/* Call Action Bar */}
                <div className="flex items-center justify-between gap-3 mt-4 pt-2 border-t border-stone-800">
                  {callActive ? (
                    <>
                      <button
                        onClick={() => timeoutMutation.mutate()}
                        title="Simulate silence / timeout"
                        className="flex-1 py-2.5 bg-amber-950 hover:bg-amber-900 text-amber-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-amber-800/50 transition"
                      >
                        <Clock className="w-4 h-4" /> Simulate Timeout
                      </button>
                      <button
                        onClick={handleHangup}
                        className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md transition active:scale-95"
                      >
                        <PhoneOff className="w-4 h-4" /> Hang Up
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startCallMutation.mutate()}
                      disabled={!selectedSeasonId || startCallMutation.isPending}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition active:scale-95 disabled:bg-stone-800 disabled:text-stone-500"
                    >
                      <Phone className="w-5 h-5 fill-current" />
                      {startCallMutation.isPending ? 'Connecting...' : 'Start Telugu Voice Call'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Controls & Live Inspection Panel (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Season & Schedule Selector Card */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200">
              <h3 className="text-base font-bold text-stone-800 mb-3 flex items-center gap-2">
                <Sprout className="w-5 h-5 text-emerald-600" />
                Select Farmer & Season for Call Evaluation
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Active Season
                  </label>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => setSelectedSeasonId(e.target.value)}
                    disabled={callActive}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 focus:ring-2 focus:ring-emerald-500"
                  >
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.farmer_name} - {s.crop_name} ({s.season_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Farmer Phone (E.164)
                  </label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    disabled={callActive}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {nextDueSchedule && (
                <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs text-emerald-900">
                  <div>
                    <span className="font-bold">Next Scheduled Call:</span> Cycle {nextDueSchedule.cycle_number} &bull; Due Window: {nextDueSchedule.due_window_start} to {nextDueSchedule.due_window_end}
                  </div>
                  <span className="px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-200 text-emerald-800 text-[10px]">
                    {nextDueSchedule.status}
                  </span>
                </div>
              )}
            </div>

            {/* Live Conversation Transcript */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-stone-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-600" />
                  Live Call Transcript & DTMF Log
                </h3>
                {transcript.length > 0 && (
                  <button
                    onClick={() => setTranscript([])}
                    className="text-xs text-stone-500 hover:text-stone-700 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Clear Log
                  </button>
                )}
              </div>

              <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 max-h-72 overflow-y-auto space-y-2.5">
                {transcript.length === 0 ? (
                  <div className="text-center py-8 text-stone-400 text-xs">
                    No active call events. Press "Start Telugu Voice Call" on the dialpad to begin.
                  </div>
                ) : (
                  transcript.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                        item.sender === 'system'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-950'
                          : 'bg-amber-50 border border-amber-200 text-amber-950 font-mono'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
                        <span className="font-semibold uppercase">{item.sender}</span>
                        <span>{item.time}</span>
                      </div>
                      {item.text}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Results & Downstream Records View */}
            {callStatus === 'completed' && (
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 space-y-3 animate-fadeIn">
                <div className="flex items-center gap-2 text-emerald-900 font-bold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Automatic Downstream Updates Recorded
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  The call engine processed farmer answers and updated the system without human intervention:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <div className="bg-white p-3 rounded-xl border border-emerald-200 text-xs">
                    <span className="font-bold text-stone-800 block mb-1">Farmer Feedback</span>
                    <span className="text-emerald-700">Source: Simulator</span>
                    <p className="text-stone-500 mt-1">Fortnightly feedback recorded with rainfall, crop condition, and problems.</p>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-200 text-xs">
                    <span className="font-bold text-stone-800 block mb-1">Irrigation Estimate</span>
                    <span className="text-emerald-700">Type: Estimated</span>
                    <p className="text-stone-500 mt-1">Calculated from pump hours &times; discharge rate with farmer reported provenance.</p>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-200 text-xs">
                    <span className="font-bold text-stone-800 block mb-1">Action Queue</span>
                    <span className="text-emerald-700">Deduplicated</span>
                    <p className="text-stone-500 mt-1">Open items generated if farmer reported water shortage, pests, or requested a callback.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Link
                    to={`/seasons/${selectedSeasonId}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-sm transition"
                  >
                    View Season Details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    to="/action-items"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 text-xs font-semibold shadow-sm transition"
                  >
                    Open Action Queue <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* TAB 2: Audio Prompts & Review Workflow Console */
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                Telugu Audio Prompts & Regulatory Review Console
              </h2>
              <p className="text-stone-500 text-xs mt-1">
                In compliance with project safety gating, audio prompts must be agronomist-reviewed and approved prior to real outbound dispatch.
              </p>
            </div>
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-1.5 rounded-lg">
              Safety Gating Active: Unreviewed prompts rejected on real Twilio lines
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Step</th>
                  <th className="py-2.5 px-3">Prompt Code</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Telugu Text</th>
                  <th className="py-2.5 px-3">English Meaning</th>
                  <th className="py-2.5 px-3">Review Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {prompts.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50/80 transition">
                    <td className="py-3 px-3 font-semibold text-stone-700">
                      {p.step_number ? `Step ${p.step_number}` : 'System'}
                    </td>
                    <td className="py-3 px-3 font-mono text-stone-600">{p.prompt_code}</td>
                    <td className="py-3 px-3 capitalize text-stone-500">{p.prompt_type}</td>
                    <td className="py-3 px-3 text-stone-800 font-medium max-w-xs">{p.text_content}</td>
                    <td className="py-3 px-3 text-stone-600 italic max-w-xs">{p.english_meaning}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          p.review_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : p.review_status === 'rejected'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {p.review_status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => {
                          setReviewModalPrompt(p);
                          setReviewStatus(p.review_status);
                          setReviewNotes(p.review_notes || '');
                        }}
                        className="px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 rounded font-medium transition"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModalPrompt && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-stone-800">
              Agronomist Review: {reviewModalPrompt.prompt_code}
            </h3>

            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 space-y-1 text-xs">
              <p className="text-stone-900 font-medium">{reviewModalPrompt.text_content}</p>
              <p className="text-stone-500 italic">{reviewModalPrompt.english_meaning}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Certification Decision
              </label>
              <select
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="draft">Draft (Unreviewed)</option>
                <option value="reviewed_agronomist">Reviewed by Agronomist</option>
                <option value="approved">Approved for Real Outbound Calls</option>
                <option value="rejected">Rejected (Needs Revision)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Agronomist Review Notes
              </label>
              <textarea
                rows={3}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Enter review comments or dialect correctness confirmation..."
                className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                onClick={() => setReviewModalPrompt(null)}
                className="px-4 py-2 rounded-lg text-stone-600 hover:bg-stone-100 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50"
              >
                {reviewMutation.isPending ? 'Saving...' : 'Save Certification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
