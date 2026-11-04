import React, { useState } from 'react';
import { UserPlus, Trash2, Mail, Users, Check, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { ViewerGroupSummary, ViewerMembershipSummary } from '@/shared/types.js';

export const ViewerInvitationsTab: React.FC<{
  projectId: string;
  groups: ViewerGroupSummary[];
  viewers: ViewerMembershipSummary[];
  onInviteViewer: (email: string, groupIds: string[]) => Promise<void>;
  onBulkInvite: (entries: { email: string; groupIds: string[] }[]) => Promise<void>;
  onRevokeViewer: (userId: string) => Promise<void>;
}> = ({ projectId, groups, viewers, onInviteViewer, onBulkInvite, onRevokeViewer }) => {
  const [singleEmail, setSingleEmail] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    groups.length > 0 ? [groups[0].id] : []
  );
  const [isInviting, setIsInviting] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const handleSingleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleEmail.trim() || selectedGroupIds.length === 0) return;

    setIsInviting(true);
    setActionMessage(null);
    try {
      await onInviteViewer(singleEmail.trim(), selectedGroupIds);
      setSingleEmail('');
      setActionMessage(`Invitation sent to ${singleEmail}`);
    } catch (err: any) {
      setActionMessage(`Error: ${err.message || 'Failed to invite viewer'}`);
    } finally {
      setIsInviting(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!bulkCsvText.trim()) return;

    const lines = bulkCsvText.split(/\r?\n/);
    const entries: { email: string; groupIds: string[] }[] = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        const email = parts[0];
        // If groups provided in second col, match names or fallback to selected
        entries.push({ email, groupIds: selectedGroupIds });
      }
    }

    if (entries.length === 0) return;

    setIsInviting(true);
    try {
      await onBulkInvite(entries);
      setShowBulkModal(false);
      setBulkCsvText('');
      setActionMessage(`Bulk invited ${entries.length} viewers.`);
    } catch (err: any) {
      setActionMessage(`Bulk invite error: ${err.message || 'Failed'}`);
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-2 max-w-4xl mx-auto">
      {/* Invite Form Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <UserPlus size={18} className="text-indigo-400" />
              <span>Invite Project Viewers</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Invite external stakeholders by email and assign them to one or more Viewer Groups.
            </p>
          </div>
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors"
          >
            <FileSpreadsheet size={14} />
            <span>Bulk CSV Invite</span>
          </button>
        </div>

        <form onSubmit={handleSingleInvite} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Viewer Email Address</label>
            <input
              type="email"
              required
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="stakeholder@partner.com"
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Assign to Viewer Groups (Union of permissions)</label>
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => {
                const isSelected = selectedGroupIds.includes(group.id);
                return (
                  <button
                    type="button"
                    key={group.id}
                    onClick={() => toggleGroup(group.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isSelected && <Check size={12} />}
                    <span>{group.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <button
              type="submit"
              disabled={isInviting || !singleEmail.trim() || selectedGroupIds.length === 0}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              <Mail size={14} />
              <span>{isInviting ? 'Sending Invite...' : 'Send Invitation Token'}</span>
            </button>
            {actionMessage && <span className="text-xs text-indigo-400">{actionMessage}</span>}
          </div>
        </form>
      </div>

      {/* Invited Viewers Table Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Users size={16} className="text-indigo-400" />
            <span>Active & Invited Viewers ({viewers.length})</span>
          </h3>
        </div>

        {viewers.length === 0 ? (
          <p className="text-xs text-slate-500">No viewers have been invited to this project yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Email</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Assigned Groups</th>
                  <th className="py-2.5 px-3 font-medium">Invited At</th>
                  <th className="py-2.5 px-3 font-medium text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                {viewers.map((viewer) => {
                  const assignedGroupNames = groups
                    .filter((g) => viewer.groupIds.includes(g.id))
                    .map((g) => g.name);

                  return (
                    <tr key={viewer.userId} className="border-b border-slate-800/60">
                      <td className="py-3 px-3 font-mono text-slate-200">{viewer.email}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            viewer.status === 'ACTIVE'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-amber-950 text-amber-400 border border-amber-800'
                          }`}
                        >
                          {viewer.status}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          {assignedGroupNames.map((name, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-500">
                        {new Date(viewer.invitedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 text-end">
                        <button
                          onClick={() => onRevokeViewer(viewer.userId)}
                          title="Revoke Viewer Access"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk CSV Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-100">Bulk Invite Viewers (CSV)</h3>
            <p className="text-xs text-slate-400">
              Paste a list of email addresses, one per line. They will be assigned to all currently selected groups.
            </p>
            <textarea
              rows={6}
              value={bulkCsvText}
              onChange={(e) => setBulkCsvText(e.target.value)}
              placeholder="auditor@firm.com&#10;client@partner.org&#10;contractor@agency.io"
              className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkSubmit}
                disabled={isInviting || !bulkCsvText.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-xl text-xs transition-colors"
              >
                Send Bulk Invites
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
