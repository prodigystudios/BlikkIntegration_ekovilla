"use client";

import Select from '../../../components/ui/Select';

export type AssigneeOption = { id: string; full_name: string | null };
// 'all' = everyone, 'mine' = current user, otherwise a specific user id.
export type AssigneeFilterValue = 'all' | 'mine' | (string & {});

// Shared "Ansvarig" filter for CRM list views (quotes, work orders). The list data is
// loaded in full (RLS lets CRM roles see all); this filters client-side by assigned_to.
export default function AssigneeFilter({
  value,
  onChange,
  users,
  className,
}: {
  value: AssigneeFilterValue;
  onChange: (value: AssigneeFilterValue) => void;
  users: AssigneeOption[];
  className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className ?? 'max-w-[190px]'}>
      <option value="all">Alla ansvariga</option>
      <option value="mine">Mina</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.full_name || 'Namnlös'}</option>
      ))}
    </Select>
  );
}

// Does an item with this assigned_to pass the filter? Centralised so both lists agree.
export function matchesAssignee(assignedTo: string | null | undefined, filter: AssigneeFilterValue, currentUserId: string | null): boolean {
  if (filter === 'all') return true;
  if (filter === 'mine') return !!currentUserId && assignedTo === currentUserId;
  return assignedTo === filter;
}
