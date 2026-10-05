"use client";

import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from './overviewFormat';
import { RecentCard } from './OverviewStates';
import type { TaskItem } from './overviewTypes';

const taskPriorityClass: Record<TaskItem['priority'], string> = {
  low: 'border-slate-200 bg-slate-100 text-slate-700',
  normal: 'border-sky-200 bg-sky-50 text-sky-700',
  high: 'border-rose-200 bg-rose-50 text-rose-700',
};

const taskPriorityLabel: Record<TaskItem['priority'], string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
};

export default function OverviewOpenTasks({ loading, failed, tasks }: {
  loading: boolean;
  failed: boolean;
  tasks: TaskItem[];
}) {
  // Uppgifterna kommer nu färdigfiltrerade (status=open) och färdigsorterade från rutten, som
  // redan ordnar på status, förfallodatum (null sist) och skapandedatum. Att sortera om dem här
  // hade gett två konkurrerande definitioner av samma korts ordning, med frågans parametrar
  // seende auktoritativa ut — exakt det som står i kommentaren om offert- och orderlistorna.
  return (
    <RecentCard title="Öppna uppgifter" href="/crm/uppgifter" loading={loading} failed={failed}>
      {tasks.length === 0 ? <EmptyState description="Inga öppna uppgifter just nu." /> : (
        <div className="grid gap-2">
          {tasks.map((task) => (
            <Link key={task.id} href={`/crm/uppgifter?task_id=${task.id}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50">
              <div className="min-w-0">
                <strong className={cn('block truncate', crm.bodyStrong)}>{task.title}</strong>
                <p className={cn('m-0 truncate', crm.meta)}>{formatDate(task.due_date)}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${taskPriorityClass[task.priority]}`}>{taskPriorityLabel[task.priority]}</span>
            </Link>
          ))}
        </div>
      )}
    </RecentCard>
  );
}
