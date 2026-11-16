import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  Calendar,
  User,
  Clock,
  Layers,
  CheckCircle2,
  AlertCircle,
  Eye,
  RefreshCw,
  Lock,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCode,
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: any;
  after: any;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
}

interface AuditStats {
  totalRecords: number;
  actionsToday: number;
  topActions: { action: string; count: number }[];
  topEntities: { entity_type: string; count: number }[];
  isAppendOnlyEnforced: boolean;
}

interface IntegrityReport {
  rowCount: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  triggerActive: boolean;
  status: string;
  message: string;
}

export const AuditPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);
  const [search, setSearch] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Selected audit log for JSON detail modal
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);

  // 1. Fetch Audit Logs Query
  const {
    data: logsResponse,
    isLoading: isLoadingLogs,
    isFetching,
    error: logsError,
    refetch: refetchLogs,
  } = useQuery<{
    success: boolean;
    data: AuditLogItem[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>({
    queryKey: ['audit-logs', page, limit, search, actionFilter, entityFilter, startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));
      if (search) params.append('search', search);
      if (actionFilter) params.append('action', actionFilter);
      if (entityFilter) params.append('entityType', entityFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      return apiRequest(`/audit?${params.toString()}`);
    },
    enabled: isAdmin,
  });

  // 2. Fetch Stats Query
  const { data: statsResponse } = useQuery<{ success: boolean; data: AuditStats }>({
    queryKey: ['audit-stats'],
    queryFn: () => apiRequest('/audit/stats'),
    enabled: isAdmin,
  });

  // 3. Fetch Integrity Verification Query
  const { data: integrityResponse, refetch: refetchIntegrity } = useQuery<{
    success: boolean;
    data: IntegrityReport;
  }>({
    queryKey: ['audit-integrity'],
    queryFn: () => apiRequest('/audit/integrity'),
    enabled: isAdmin,
  });

  const logs = logsResponse?.data || [];
  const meta = logsResponse?.meta || { total: 0, page: 1, limit: 20, totalPages: 1 };
  const stats = statsResponse?.data;
  const integrity = integrityResponse?.data;

  const handleInspect = (log: AuditLogItem) => {
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  const getActionBadgeVariant = (action: string) => {
    if (action.includes('LOGIN_FAILED') || action.includes('REVOKE') || action.includes('DELETE') || action.includes('REJECT')) {
      return 'danger';
    }
    if (action.includes('CREATE') || action.includes('SUCCESS') || action.includes('ISSUE') || action.includes('SEAL')) {
      return 'success';
    }
    if (action.includes('UPDATE') || action.includes('CHANGE')) {
      return 'warning';
    }
    return 'neutral';
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Audit Trail</h1>
            <Badge variant="success">IMMUTABLE LOGS</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Tamper-proof, append-only security log tracking all administrative changes, logins, certificate issuances, and data updates.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchLogs();
              refetchIntegrity();
            }}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh Trail
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="p-4 flex items-center space-x-3">
            <div className="p-2.5 bg-forest-50 text-forest-700 rounded-xl">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Audit Records</p>
              <p className="text-xl font-bold text-gray-900">{stats?.totalRecords?.toLocaleString() ?? '—'}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-4 flex items-center space-x-3">
            <div className="p-2.5 bg-blue-50 text-blue-700 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions Today</p>
              <p className="text-xl font-bold text-gray-900">{stats?.actionsToday?.toLocaleString() ?? 0}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-4 flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tamper Protection</p>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700">Enforced by Trigger</span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-4 flex items-center space-x-3">
            <div className="p-2.5 bg-amber-50 text-amber-700 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Access Scope</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">System Admin Only</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search action, entity ID, user name, or email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              />
            </div>

            <div>
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="">All Actions</option>
                <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
                <option value="LOGIN_FAILED">LOGIN_FAILED</option>
                <option value="PASSWORD_CHANGED">PASSWORD_CHANGED</option>
                <option value="ISSUE_CERTIFICATE">ISSUE_CERTIFICATE</option>
                <option value="SEAL_CERTIFICATE">SEAL_CERTIFICATE</option>
                <option value="REVOKE_CERTIFICATE">REVOKE_CERTIFICATE</option>
                <option value="UPDATE_SETTING">UPDATE_SETTING</option>
                <option value="CREATE_FARMER">CREATE_FARMER</option>
                <option value="CREATE_SURVEY">CREATE_SURVEY</option>
              </select>
            </div>

            <div>
              <select
                value={entityFilter}
                onChange={(e) => {
                  setEntityFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="">All Entities</option>
                <option value="users">users</option>
                <option value="farmers">farmers</option>
                <option value="certificates">certificates</option>
                <option value="app_settings">app_settings</option>
                <option value="surveys">surveys</option>
                <option value="observations">observations</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100 text-xs text-gray-500">
            <span className="font-medium">Filter by Date:</span>
            <div className="flex items-center space-x-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1 text-xs border rounded bg-white text-gray-700"
              />
              <span>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1 text-xs border rounded bg-white text-gray-700"
              />
            </div>
            {(search || actionFilter || entityFilter || startDate || endDate) && (
              <button
                onClick={() => {
                  setSearch('');
                  setActionFilter('');
                  setEntityFilter('');
                  setStartDate('');
                  setEndDate('');
                  setPage(1);
                }}
                className="text-xs text-forest-700 font-semibold hover:underline ml-auto"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Main Audit Records Table */}
      <Card>
        {isLoadingLogs ? (
          <div className="py-16 text-center text-sm text-gray-500">Loading audit trail...</div>
        ) : logsError ? (
          <div className="py-12 text-center text-sm text-red-600 font-medium">
            Failed to load audit logs. Only administrators may view this record.
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-medium text-gray-700">No matching audit records</p>
            <p className="text-xs text-gray-400 mt-1">Try relaxing your search terms or filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-semibold border-b">
                <tr>
                  <th className="py-3 px-3.5">Timestamp (IST)</th>
                  <th className="py-3 px-3.5">User</th>
                  <th className="py-3 px-3.5">Action</th>
                  <th className="py-3 px-3.5">Entity</th>
                  <th className="py-3 px-3.5">Entity ID</th>
                  <th className="py-3 px-3.5">IP Address</th>
                  <th className="py-3 px-3.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => {
                  const dateStr = new Date(log.created_at).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  });

                  return (
                    <tr key={log.id} className="hover:bg-gray-50/60">
                      <td className="py-3 px-3.5 font-mono text-gray-700 whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-gray-900">{log.user_name || 'System / Automated'}</div>
                        <div className="text-2xs text-gray-400 font-mono">{log.user_email || 'internal'}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <Badge variant={getActionBadgeVariant(log.action)} size="sm">
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-gray-700">
                        {log.entity_type}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-2xs text-gray-500 max-w-[140px] truncate" title={log.entity_id || ''}>
                        {log.entity_id || '—'}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-2xs text-gray-500">
                        {log.ip || '—'}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleInspect(log)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {meta.totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Showing page <strong className="text-gray-900">{meta.page}</strong> of{' '}
              <strong className="text-gray-900">{meta.totalPages}</strong> ({meta.total} total events)
            </span>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail JSON Modal */}
      {selectedLog && (
        <Modal
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title={`Audit Log Record: ${selectedLog.action}`}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl">
              <div>
                <p className="text-2xs uppercase text-gray-400 font-semibold">User</p>
                <p className="font-medium text-gray-900">{selectedLog.user_name || 'System'}</p>
                <p className="text-2xs font-mono text-gray-500">{selectedLog.user_email || '—'}</p>
              </div>
              <div>
                <p className="text-2xs uppercase text-gray-400 font-semibold">Timestamp (IST)</p>
                <p className="font-mono text-gray-800">
                  {new Date(selectedLog.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase text-gray-400 font-semibold">Entity Target</p>
                <p className="font-mono text-gray-800">{selectedLog.entity_type} ({selectedLog.entity_id || 'N/A'})</p>
              </div>
              <div>
                <p className="text-2xs uppercase text-gray-400 font-semibold">Client Info</p>
                <p className="font-mono text-gray-800">IP: {selectedLog.ip || 'Localhost'}</p>
              </div>
            </div>

            {/* Before / After State */}
            <div className="space-y-2">
              <p className="font-semibold text-gray-800 flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-forest-700" />
                State Snapshot Diff
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-2xs uppercase text-gray-400 font-semibold mb-1">State Before</p>
                  <pre className="p-3 bg-gray-900 text-gray-100 rounded-xl overflow-x-auto text-2xs font-mono max-h-48">
                    {selectedLog.before ? JSON.stringify(selectedLog.before, null, 2) : 'null (Created or Read-Only)'}
                  </pre>
                </div>
                <div>
                  <p className="text-2xs uppercase text-gray-400 font-semibold mb-1">State After</p>
                  <pre className="p-3 bg-gray-900 text-emerald-300 rounded-xl overflow-x-auto text-2xs font-mono max-h-48">
                    {selectedLog.after ? JSON.stringify(selectedLog.after, null, 2) : 'null (Deleted or Unmodified)'}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setIsDetailOpen(false)}>
                Close Record
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
