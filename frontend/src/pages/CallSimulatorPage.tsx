import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
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
  Radio,
  Send,
  MessageSquare,
  AlertCircle,
  Check,
  Award,
  Eye,
  Info,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { Modal } from '../components/ui/Modal.js';
import { Button } from '../components/ui/Button.js';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFarmerId = searchParams.get('farmerId') || '';

  // Tab State: 'simulator' | 'live' | 'prompts'
  const [activeTab, setActiveTab] = useState<'simulator' | 'live' | 'prompts'>('simulator');

  // Authorized Farmers List
  const { data: farmersData } = useQuery<any>({
    queryKey: ['authorized-farmers'],
    queryFn: async () => apiRequest<any>('/farmers?limit=200'),
  });
  const farmers: any[] = (Array.isArray(farmersData) ? farmersData : farmersData?.data) || [];

  const [selectedFarmerId, setSelectedFarmerId] = useState<string>(urlFarmerId);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('+919876543210');

  // Sync selectedFarmerId when URL param changes
  useEffect(() => {
    if (urlFarmerId && urlFarmerId !== selectedFarmerId) {
      setSelectedFarmerId(urlFarmerId);
    }
  }, [urlFarmerId]);

  // Default to first demo farmer or first farmer if none selected
  useEffect(() => {
    if (!selectedFarmerId && farmers.length > 0) {
      const defaultFarmer = farmers.find((f: any) => f.data_origin === 'demo') || farmers[0];
      setSelectedFarmerId(defaultFarmer.id);
    }
  }, [farmers, selectedFarmerId]);

  const selectedFarmer = farmers.find((f: any) => f.id === selectedFarmerId);

  // Auto-fill phone when selected farmer changes
  useEffect(() => {
    if (selectedFarmer?.primary_phone) {
      setPhoneNumber(selectedFarmer.primary_phone);
    }
  }, [selectedFarmer]);

  // Farmer's Seasons (both active and past)
  const { data: farmerSeasonsData = [] } = useQuery<any>({
    queryKey: ['farmer-seasons', selectedFarmerId],
    queryFn: async () => {
      if (!selectedFarmerId) return [];
      const res = await apiRequest<any>(`/seasons?farmer_id=${selectedFarmerId}`);
      return (Array.isArray(res) ? res : res?.data) || [];
    },
    enabled: !!selectedFarmerId,
  });
  const seasons: SeasonOption[] = farmerSeasonsData;

  // Auto-select first active season (or first season) for the selected farmer
  useEffect(() => {
    if (seasons.length > 0) {
      const active = seasons.find((s) => s.status === 'active') || seasons[0];
      setSelectedSeasonId(active.id);
    } else {
      setSelectedSeasonId('');
    }
  }, [seasons]);

  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId);

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

  const isPhoneVerified = selectedFarmer?.phone_verified ?? false;
  const isDemoFarmer = selectedFarmer?.data_origin === 'demo';

  // Audio Prompts
  const { data: prompts = [], refetch: refetchPrompts } = useQuery<AudioPrompt[]>({
    queryKey: ['audio-prompts'],
    queryFn: async () => {
      const res = await apiRequest<AudioPrompt[]>('/telephony/prompts');
      return res || [];
    },
  });

  // Call Logs
  const { data: callLogs = [], refetch: refetchLogs } = useQuery<any[]>({
    queryKey: ['telephony-logs'],
    queryFn: async () => {
      const res = await apiRequest<any[]>('/telephony/logs');
      return res || [];
    },
  });

  // Selected Call Attempt for Details Modal
  const [selectedCallAttemptId, setSelectedCallAttemptId] = useState<string | null>(null);
  const { data: callDetailsData, isLoading: isLoadingDetails } = useQuery<any>({
    queryKey: ['call-attempt-details', selectedCallAttemptId],
    queryFn: async () => {
      if (!selectedCallAttemptId) return null;
      return await apiRequest<any>(`/telephony/attempts/${selectedCallAttemptId}`);
    },
    enabled: !!selectedCallAttemptId,
  });

  // Simulator Call State
  const [callActive, setCallActive] = useState<boolean>(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'completed' | 'opted_out'>('idle');
  const [sessionId, setSessionId] = useState<string>('');
  const [currentAction, setCurrentAction] = useState<StepAction | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [inputBuffer, setInputBuffer] = useState<string>('');
  const [transcript, setTranscript] = useState<Array<{ sender: 'system' | 'user'; text: string; time: string }>>([]);
  const [reviewModalPrompt, setReviewModalPrompt] = useState<AudioPrompt | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>('approved');
  const [reviewNotes, setReviewNotes] = useState<string>('');

  // Live Call State
  const [isLiveConfirmOpen, setIsLiveConfirmOpen] = useState(false);
  const [liveCallResult, setLiveCallResult] = useState<any | null>(null);

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

  const nextDueSchedule = schedules.find((s) => s.status === 'scheduled') || schedules[0];

  // Start Simulator Call Mutation
  const startCallMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/telephony/simulator/start', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: selectedSeasonId || undefined,
          farmerId: selectedFarmerId || selectedSeason?.farmer_id || undefined,
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
      alert(`Failed to start simulator call: ${err.message}`);
    },
  });

  // Start Live Call Mutation
  const liveCallMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/telephony/call/live', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: selectedSeasonId || undefined,
          farmerId: selectedFarmerId || selectedSeason?.farmer_id || undefined,
          scheduleId: nextDueSchedule?.id || undefined,
          phoneE164: phoneNumber?.trim() || undefined,
        }),
      });
    },
    onSuccess: (data: any) => {
      setLiveCallResult(data);
      setIsLiveConfirmOpen(false);
      refetchLogs();
    },
    onError: (err: any) => {
      setLiveCallResult({
        success: false,
        error: err.code || 'CALL_FAILED',
        message: err.message,
        fallbackSmsSent: Boolean(err.details?.fallbackSmsSent),
        fallbackSmsContent: err.details?.fallbackSmsSent
          ? err.details?.fallbackSmsContent || `నమస్కారం ${selectedFarmer?.full_name || selectedSeason?.farmer_name || 'రైతు సోదరులారా'}, స్మార్ట్ సాగు నీటి సలహా వ్యవస్థ నుండి మీ పంటకు సాగు నీటి సలహా: ప్రస్తుతం తగినంత తేమ ఉండేలా చూసుకోండి. వివరాలకు పంచాయతీని సంప్రదించండి.`
          : null,
      });
      setIsLiveConfirmOpen(false);
      refetchLogs();
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
              Telugu IVR Voice Engine & Outbound Telephony
            </div>
            <h1 className="text-2xl font-bold">Telephony & Voice Advisory Console</h1>
            <p className="text-emerald-100 text-sm mt-1 max-w-2xl">
              Conduct interactive simulated IVR call evaluations or place live cellular voice calls to registered Andhra Pradesh farmers via Twilio.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-emerald-950/50 p-1.5 rounded-xl border border-emerald-700/50">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'simulator'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              🎮 Simulation Mode
            </button>
            <button
              onClick={() => setActiveTab('live')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                activeTab === 'live'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" /> Live Mode (Twilio)
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'prompts'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              Prompts ({prompts.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'simulator' ? (
        /* TAB 1: Simulation Mode */
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
                        ? 'Call in Progress (Simulated)'
                        : callStatus === 'opted_out'
                        ? 'Opted Out'
                        : callStatus === 'completed'
                        ? 'Call Completed'
                        : 'Simulator Ready'}
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
                    {selectedFarmer?.full_name || selectedSeason?.farmer_name || 'Select Farmer'}
                  </h3>
                  <p className="text-stone-400 text-xs">
                    {phoneNumber} &bull; {selectedSeason?.crop_name || 'General Advisory'} ({selectedFarmer?.village_name || selectedSeason?.village_name || 'Panchayat'})
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
                      disabled={!selectedFarmerId || !isDemoFarmer || startCallMutation.isPending}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition active:scale-95 disabled:bg-stone-800 disabled:text-stone-500"
                    >
                      <Phone className="w-5 h-5 fill-current" />
                      {startCallMutation.isPending
                        ? 'Connecting...'
                        : !isDemoFarmer
                        ? 'Demo Farmers Only (Gated)'
                        : !selectedFarmerId
                        ? 'Select a Farmer'
                        : 'Start Telugu Voice Call (Simulation)'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Controls & Live Inspection Panel (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Farmer & Season Selector Card */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-stone-800 flex items-center gap-2">
                  <Sprout className="w-5 h-5 text-emerald-600" />
                  Select Farmer & Season for Call Evaluation
                </h3>
                {selectedFarmerId && (
                  <Link
                    to={`/farmers/${selectedFarmerId}`}
                    className="text-xs text-forest-700 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <User className="w-3.5 h-3.5" /> View Farmer Profile <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Farmer Dropdown */}
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Select Farmer ({farmers.length} Available)
                  </label>
                  <select
                    value={selectedFarmerId}
                    onChange={(e) => {
                      setSelectedFarmerId(e.target.value);
                      setSearchParams({ farmerId: e.target.value });
                    }}
                    disabled={callActive}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 focus:ring-2 focus:ring-emerald-500"
                  >
                    {farmers.map((f: any) => (
                      <option key={f.id} value={f.id}>
                        {f.full_name} ({f.farmer_code}) - {f.village_name} {f.data_origin === 'demo' ? '[DEMO]' : '[FIELD]'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Linked Season Dropdown */}
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Linked Season ({seasons.length})
                  </label>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => setSelectedSeasonId(e.target.value)}
                    disabled={callActive || seasons.length === 0}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                  >
                    {seasons.length === 0 ? (
                      <option value="">No registered seasons (Generic Advisory)</option>
                    ) : (
                      seasons.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.crop_name} - {s.season_code} ({s.status})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* Farmer Phone Field */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-stone-600">
                      Farmer Phone (E.164)
                    </label>
                    {isPhoneVerified ? (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                        <Check className="w-3 h-3 text-emerald-600" /> Verified
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3 text-amber-600" /> Unverified
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    disabled={callActive}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Farmer Meta Badge / Origin */}
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Farmer Data Provenance & Scope
                  </label>
                  <div className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs flex items-center justify-between">
                    <span className="font-medium text-stone-700 truncate mr-2">
                      {selectedFarmer?.village_name || 'Village Scoped'}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                      isDemoFarmer
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}>
                      {isDemoFarmer ? 'Demo Account' : 'Verified Field Record'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Informative notices */}
              {!isDemoFarmer && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <strong>Interactive Simulator Gating:</strong> This farmer is marked as verified field data (<code>real</code>). The simulated dialpad is safety-gated to demo accounts to protect production irrigation audits. Use <strong>Live Mode</strong> to dispatch real cellular calls, or pick a demo farmer to test dialpad interactions.
                  </div>
                </div>
              )}

              {seasons.length === 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                  <div>
                    <strong>No Registered Seasons:</strong> This farmer currently has no active or past agricultural seasons. Dialpad test calls will evaluate standard baseline questions. You can add a season in the <Link to={`/farmers/${selectedFarmerId}`} className="underline font-bold">Farmer Profile</Link>.
                  </div>
                </div>
              )}

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
          </div>
        </div>
      ) : activeTab === 'live' ? (
        /* TAB 2: Live Mode (Twilio Voice & Fallback SMS) */
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                  <Radio className="w-5 h-5 text-amber-600" />
                  Real Outbound Voice Dispatcher (Twilio Live PSTN)
                </h2>
                <p className="text-stone-500 text-xs mt-1">
                  Place an actual voice call to a farmer's cellular phone. If unanswered or failed, an automatic fallback Telugu SMS advisory is triggered immediately.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500">Recipient Phone Status:</span>
                {isPhoneVerified ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Unverified
                  </span>
                )}
              </div>
            </div>

            {/* Selection Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Select Farmer
                </label>
                <select
                  value={selectedFarmerId}
                  onChange={(e) => {
                    setSelectedFarmerId(e.target.value);
                    setSearchParams({ farmerId: e.target.value });
                  }}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl text-sm text-stone-800 focus:ring-2 focus:ring-amber-500"
                >
                  {farmers.map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.full_name} ({f.farmer_code}) - {f.village_name} {f.data_origin === 'demo' ? '[DEMO]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Linked Season ({seasons.length})
                </label>
                <select
                  value={selectedSeasonId}
                  onChange={(e) => setSelectedSeasonId(e.target.value)}
                  disabled={seasons.length === 0}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl text-sm text-stone-800 focus:ring-2 focus:ring-amber-500 disabled:opacity-60"
                >
                  {seasons.length === 0 ? (
                    <option value="">No registered seasons (Generic)</option>
                  ) : (
                    seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.crop_name} - {s.season_code} ({s.status})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Target Cellular Phone Number (E.164)
                </label>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono text-stone-800 focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {!isPhoneVerified && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-800 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <strong>Live Call Gating Active:</strong> This farmer's phone number is unverified.
                  To prevent unauthorized automated calls, complete OTP phone verification in the <Link to={`/farmers/${selectedFarmerId}`} className="underline font-bold">Farmer Profile</Link> before placing live outbound calls.
                </div>
              </div>
            )}

            {/* Live Dispatch Button */}
            <div className="flex items-center justify-between p-4 bg-stone-50 rounded-2xl border border-stone-200">
              <div className="text-xs text-stone-600 space-y-0.5">
                <p className="font-semibold text-stone-800">Ready to dispatch voice call?</p>
                <p>Twilio carrier rates will apply. Fallback Telugu SMS advisory is enabled.</p>
              </div>

              <Button
                variant="primary"
                onClick={() => setIsLiveConfirmOpen(true)}
                disabled={!isPhoneVerified || liveCallMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
              >
                <PhoneCall className="w-4 h-4 mr-2" />
                Place Live Outbound Call
              </Button>
            </div>

            {/* Live Call Result Panel */}
            {liveCallResult && (
              <div className={`p-4 rounded-xl border text-xs space-y-2 ${
                liveCallResult.success
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}>
                <div className="flex items-center gap-2 font-bold text-sm">
                  {liveCallResult.success ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Live Call Initiated!
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-amber-600" /> Outbound Call Status
                    </>
                  )}
                </div>
                <p>{liveCallResult.message || liveCallResult.error}</p>
                {liveCallResult.callSid && (
                  <p className="font-mono text-[11px] text-stone-500">Twilio Call SID: {liveCallResult.callSid}</p>
                )}
                {liveCallResult.fallbackSmsSent && (
                  <div className="mt-2 pt-2 border-t border-amber-200">
                    <p className="font-bold flex items-center gap-1.5 text-amber-950 mb-1">
                      <MessageSquare className="w-3.5 h-3.5" /> Fallback Telugu SMS Advisory Dispatched:
                    </p>
                    <blockquote className="p-2 bg-white rounded border border-amber-200 italic font-serif text-[11px]">
                      {liveCallResult.fallbackSmsContent}
                    </blockquote>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Call Logs & Audit Table */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-stone-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" /> Recent Telephony Attempts & Communication Logs
              </h3>
              <button
                onClick={() => refetchLogs()}
                className="text-xs text-forest-700 hover:underline flex items-center gap-1 font-semibold"
              >
                <RotateCcw className="w-3 h-3" /> Refresh Logs
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Farmer & Season</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">Provider</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Duration</th>
                    <th className="py-2.5 px-3">Fallback SMS / Notes</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {callLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-stone-400">
                        No recent call logs found.
                      </td>
                    </tr>
                  ) : (
                    callLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-stone-50/80 transition">
                        <td className="py-2.5 px-3 text-stone-500 whitespace-nowrap">
                          {new Date(log.started_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          {log.farmer_id ? (
                            <Link
                              to={`/farmers/${log.farmer_id}`}
                              className="text-forest-700 hover:underline font-semibold flex items-center gap-1"
                            >
                              <User className="w-3.5 h-3.5 inline text-forest-600 shrink-0" />
                              <span>{log.farmer_name || log.farmer_code || 'Farmer Profile'}</span>
                            </Link>
                          ) : (
                            <span>{log.farmer_name || log.farmer_code || 'Unknown Farmer'}</span>
                          )}
                          {log.season_code && (
                            <span className="block text-[10px] text-stone-400 font-normal">
                              {log.season_code} {log.crop_name ? `• ${log.crop_name}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-600">
                          {log.contact_phone || log.phone_e164 || '-'}
                        </td>
                        <td className="py-2.5 px-3 uppercase text-stone-600 font-semibold text-[10px]">
                          {log.provider}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            log.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : log.status === 'failed' || log.status === 'no_answer'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-600">
                          {log.duration_seconds ? `${log.duration_seconds}s` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-stone-500 max-w-xs truncate" title={log.error_message}>
                          {log.fallback_sms_sent ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <MessageSquare className="w-3 h-3 text-amber-600" /> SMS Dispatched
                            </span>
                          ) : log.error_message ? (
                            <span className="text-rose-600">{log.error_message}</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedCallAttemptId(log.id)}
                            className="text-[11px] py-1 px-2.5"
                          >
                            <Eye className="w-3 h-3 mr-1" /> Details
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* TAB 3: Audio Prompts & Review Workflow Console */
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

      {/* Live Call Confirmation Warning Modal */}
      <Modal
        isOpen={isLiveConfirmOpen}
        onClose={() => setIsLiveConfirmOpen(false)}
        title="⚠️ Confirm Live Outbound Call"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Live Cellular Call Warning
            </p>
            <p>
              You are about to initiate an actual phone call to <strong>{selectedSeason?.farmer_name}</strong> at:
            </p>
            <p className="font-mono text-base font-bold text-amber-950 text-center py-1">
              {phoneNumber}
            </p>
            <ul className="list-disc list-inside space-y-1 text-stone-600 text-[11px] pt-1 border-t border-amber-200">
              <li>This will ring the farmer's mobile device via Twilio PSTN.</li>
              <li>Ensure the recipient expects this call to avoid disturbance.</li>
              <li>If unanswered or failed, an automatic fallback Telugu SMS will be dispatched.</li>
            </ul>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsLiveConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => liveCallMutation.mutate()}
              isLoading={liveCallMutation.isPending}
              disabled={liveCallMutation.isPending}
            >
              Confirm & Dispatch Call
            </Button>
          </div>
        </div>
      </Modal>

      {/* Prompt Review Modal */}
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
      {/* Call Details Modal */}
      <Modal
        isOpen={Boolean(selectedCallAttemptId)}
        onClose={() => setSelectedCallAttemptId(null)}
        title="📞 Telephony Call Details & IVR Responses"
        maxWidth="2xl"
      >
        {isLoadingDetails ? (
          <div className="py-8 text-center text-stone-500 text-xs">Loading call attempt records...</div>
        ) : !callDetailsData?.data ? (
          <div className="py-8 text-center text-stone-500 text-xs">Call attempt record not found.</div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Overview Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-stone-50 p-3 rounded-xl border border-stone-200">
              <div>
                <span className="text-stone-400 uppercase text-[10px] font-semibold">Status</span>
                <p className="font-bold text-stone-800 capitalize mt-0.5">{callDetailsData.data.status}</p>
              </div>
              <div>
                <span className="text-stone-400 uppercase text-[10px] font-semibold">Provider</span>
                <p className="font-bold text-stone-800 uppercase mt-0.5">{callDetailsData.data.provider}</p>
              </div>
              <div>
                <span className="text-stone-400 uppercase text-[10px] font-semibold">Duration</span>
                <p className="font-bold text-stone-800 mt-0.5">
                  {callDetailsData.data.duration_seconds ? `${callDetailsData.data.duration_seconds}s` : '-'}
                </p>
              </div>
              <div>
                <span className="text-stone-400 uppercase text-[10px] font-semibold">Started</span>
                <p className="font-medium text-stone-700 mt-0.5">
                  {new Date(callDetailsData.data.started_at).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Recipient & Farmer Context */}
            <div className="p-3 bg-white rounded-xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-stone-400 uppercase text-[10px] font-semibold">Recipient Farmer</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-bold text-stone-900 text-sm">
                    {callDetailsData.data.farmer_name || 'Unlinked / Ad-hoc Farmer'}
                  </span>
                  {callDetailsData.data.farmer_code && (
                    <span className="font-mono text-stone-500 text-xs">
                      ({callDetailsData.data.farmer_code})
                    </span>
                  )}
                  {callDetailsData.data.village_name && (
                    <span className="text-stone-500 text-xs">&bull; {callDetailsData.data.village_name}</span>
                  )}
                </div>
                <div className="text-stone-500 text-[11px] mt-1 space-x-2">
                  <span className="font-mono">Phone: {callDetailsData.data.phone_e164 || '-'}</span>
                  {callDetailsData.data.season_code && (
                    <span>
                      &bull; Season: <strong>{callDetailsData.data.crop_name}</strong> ({callDetailsData.data.season_code})
                    </span>
                  )}
                </div>
              </div>

              {callDetailsData.data.farmer_id && (
                <Link
                  to={`/farmers/${callDetailsData.data.farmer_id}`}
                  className="px-3 py-1.5 bg-forest-50 hover:bg-forest-100 text-forest-700 rounded-lg font-semibold inline-flex items-center gap-1.5 shrink-0 transition"
                  onClick={() => setSelectedCallAttemptId(null)}
                >
                  <User className="w-3.5 h-3.5" /> Farmer Profile <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            {/* Fallback SMS Section */}
            {callDetailsData.data.fallback_sms_content && (
              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-950 flex items-center gap-1.5 text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-amber-700" />
                    Automatic Fallback Telugu SMS Advisory
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 uppercase font-semibold">
                    {callDetailsData.data.fallback_sms_status || 'Delivered'}
                  </span>
                </div>
                <p className="text-stone-800 italic font-serif text-[11px] bg-white p-2.5 rounded-lg border border-amber-200">
                  {callDetailsData.data.fallback_sms_content}
                </p>
              </div>
            )}

            {/* Error Message if any */}
            {callDetailsData.data.error_message && (
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <strong>Call Failure Reason:</strong> {callDetailsData.data.error_message}
                </div>
              </div>
            )}

            {/* DTMF Survey Responses */}
            <div>
              <h4 className="font-bold text-stone-800 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Survey & Advisory DTMF Responses ({callDetailsData.data.responses?.length || 0})
              </h4>
              {!callDetailsData.data.responses || callDetailsData.data.responses.length === 0 ? (
                <div className="p-4 bg-stone-50 rounded-xl text-center text-stone-400">
                  No DTMF survey responses were recorded during this call attempt.
                </div>
              ) : (
                <div className="border border-stone-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-100 text-stone-600 font-semibold border-b border-stone-200">
                      <tr>
                        <th className="py-2 px-3">Step</th>
                        <th className="py-2 px-3">Question</th>
                        <th className="py-2 px-3">Key Pressed</th>
                        <th className="py-2 px-3">Interpreted Answer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {callDetailsData.data.responses.map((resp: any) => (
                        <tr key={resp.id} className="hover:bg-stone-50">
                          <td className="py-2 px-3 font-semibold text-stone-700">Step {resp.step_number}</td>
                          <td className="py-2 px-3 max-w-xs">
                            <p className="font-medium text-stone-800">{resp.question_text_te}</p>
                            <p className="text-stone-400 italic text-[10px]">{resp.question_text_en}</p>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-amber-700">{resp.response_digits}</td>
                          <td className="py-2 px-3 font-medium text-emerald-800">
                            {resp.interpreted_value ? JSON.stringify(resp.interpreted_value) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-200">
              <Button variant="outline" onClick={() => setSelectedCallAttemptId(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
