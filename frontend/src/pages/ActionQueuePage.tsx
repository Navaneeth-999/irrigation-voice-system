import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  PhoneCall,
  UserCheck,
  Filter,
  Search,
  MessageSquare,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';

export const ActionQueuePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER' || user?.role === 'AGRI_PANCHAYAT';

  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Selected item for update modal
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [newStatus, setNewStatus] = useState<'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed'>('resolved');
  const [resolutionNote, setResolutionNote] = useState('');

  // Queries
  const { data: actionItems, isLoading } = useQuery<any[]>({
    queryKey: ['action-items', statusFilter, priorityFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (priorityFilter !== 'all') params.append('priority', priorityFilter);
      if (typeFilter !== 'all') params.append('type', typeFilter);
      return apiRequest<any[]>(`/action-items?${params.toString()}`);
    },
  });

  const updateActionMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      apiRequest(`/action-items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items'] });
      setSelectedItem(null);
      setResolutionNote('');
    },
    onError: (err: any) => alert(err.message),
  });

  const handleOpenUpdate = (item: any) => {
    setSelectedItem(item);
    setNewStatus(item.status === 'open' ? 'in_progress' : 'resolved');
    setResolutionNote(item.referral_note || '');
  };

  const handleUpdateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    updateActionMutation.mutate({
      id: selectedItem.id,
      payload: {
        status: newStatus,
        referral_note: resolutionNote,
      },
    });
  };

  const filteredItems = actionItems?.filter((item) => {
    const q = search.toLowerCase();
    return (
      item.farmer_name?.toLowerCase().includes(q) ||
      item.village_name?.toLowerCase().includes(q) ||
      item.type?.toLowerCase().includes(q) ||
      item.referral_note?.toLowerCase().includes(q)
    );
  });

  // KPI counts
  const highPriorityCount = actionItems?.filter((i) => i.priority === 'high' || i.priority === 'critical').length || 0;
  const waterIssuesCount = actionItems?.filter((i) => i.type.includes('water') || i.type.includes('pump')).length || 0;
  const callbacksCount = actionItems?.filter((i) => i.type === 'callback_requested').length || 0;

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'water_shortage':
        return 'Water Shortage (నీటి కొరత)';
      case 'pump_power_problem':
        return 'Pump / Power Fault (మోటార్/కరెంట్)';
      case 'source_unavailable':
        return 'Source Dry / Unavailable';
      case 'crop_pest_disease':
        return 'Crop Pest / Disease (తెగులు)';
      case 'crop_condition_poor':
        return 'Crop Condition Poor (పంట దెబ్బతిన్నది)';
      case 'callback_requested':
        return 'Volunteer Callback (కాల్ కోరారు)';
      case 'repeated_missed_calls':
        return 'Repeated Missed Calls';
      case 'suspicious_data':
        return 'Suspicious Data Flag';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return <Badge variant="danger">Critical</Badge>;
      case 'high':
        return <Badge variant="danger">High</Badge>;
      case 'medium':
        return <Badge variant="warning">Medium</Badge>;
      case 'low':
        return <Badge variant="neutral">Low</Badge>;
      default:
        return <Badge>{priority}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <AlertCircle className="w-7 h-7 text-amber-600" />
          <span>Action Items Queue (ఫీల్డ్ కార్యాచరణ క్యూ)</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage field exceptions, water shortage alerts, and callback requests raised during voice call cycles.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-amber-500 bg-amber-50/30">
          <p className="text-xs font-medium text-amber-700 uppercase">Filtered Items</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{actionItems?.length || 0}</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-red-500 bg-red-50/30">
          <p className="text-xs font-medium text-red-700 uppercase">High / Critical</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{highPriorityCount}</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-water-500 bg-water-50/30">
          <p className="text-xs font-medium text-water-700 uppercase">Water Problems</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{waterIssuesCount}</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-purple-500 bg-purple-50/30">
          <p className="text-xs font-medium text-purple-700 uppercase">Callback Requests</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{callbacksCount}</p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search farmer, village, problem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              {['all', 'open', 'in_progress', 'resolved'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                    statusFilter === st ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              <option value="all">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Action Items Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">Loading action items...</div>
        ) : filteredItems?.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
            <p className="font-semibold text-gray-700">All clear! No pending action items.</p>
            <p className="text-xs text-gray-400 mt-1">Issues reported by farmers in IVR calls appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Issue Type</th>
                  <th className="py-3 px-4">Farmer & Phone</th>
                  <th className="py-3 px-4">Referral Description</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Reported</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems?.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4">{getPriorityBadge(item.priority)}</td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-900 text-xs">{getTypeLabel(item.type)}</div>
                      <span className="text-[11px] text-gray-400 uppercase font-mono">Source: {item.source}</span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{item.farmer_name}</div>
                      <div className="text-xs font-mono text-forest-700">{item.farmer_phone}</div>
                      <div className="text-[11px] text-gray-400">{item.village_name}</div>
                    </td>

                    <td className="py-3 px-4 text-xs text-gray-600 max-w-xs">
                      <p className="line-clamp-2">{item.referral_note || 'No notes provided'}</p>
                    </td>

                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          item.status === 'resolved' || item.status === 'closed'
                            ? 'success'
                            : item.status === 'in_progress'
                            ? 'info'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {item.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </td>

                    <td className="py-3 px-4 text-xs text-gray-400 font-mono">
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-4 text-right">
                      {canManage && (
                        <Button size="sm" variant="secondary" onClick={() => handleOpenUpdate(item)}>
                          Update
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal: Update / Resolve Action Item */}
      <Modal isOpen={Boolean(selectedItem)} onClose={() => setSelectedItem(null)} title="Update Action Item Status">
        {selectedItem && (
          <form onSubmit={handleUpdateSubmit} className="space-y-4">
            <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1">
              <p>
                Farmer: <strong className="font-semibold text-gray-900">{selectedItem.farmer_name}</strong> (
                {selectedItem.village_name})
              </p>
              <p>
                Phone: <strong className="font-mono text-forest-700">{selectedItem.farmer_phone}</strong>
              </p>
              <p>
                Problem: <strong className="font-semibold text-gray-900">{getTypeLabel(selectedItem.type)}</strong>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Status *</label>
              <select
                value={newStatus}
                onChange={(e: any) => setNewStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
              >
                <option value="open">Open (పరిష్కరించాల్సి ఉంది)</option>
                <option value="in_progress">In Progress (పని జరుగుతుంది)</option>
                <option value="resolved">Resolved (పరిష్కారమైంది)</option>
                <option value="closed">Closed (ముగిసింది)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Resolution / Referral Notes *</label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                required
                rows={3}
                placeholder="Details of action taken (e.g. Volunteer visited, canal flow restored)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setSelectedItem(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateActionMutation.isPending}>
                {updateActionMutation.isPending ? 'Updating...' : 'Save Resolution'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
