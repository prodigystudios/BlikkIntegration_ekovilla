import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/shared/cn';

type DataTableProps = HTMLAttributes<HTMLTableElement> & {
  containerClassName?: string;
};

export function DataTable({ className, containerClassName, children, ...props }: DataTableProps) {
  return (
    <div className={cn('w-full min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200', containerClassName)}>
      <table className={cn('w-full border-collapse', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

type DataTableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement>;

export function DataTableHeaderCell({ className, ...props }: DataTableHeaderCellProps) {
  return <th className={cn('px-2.5 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.5px] text-slate-700', className)} {...props} />;
}

type DataTableCellProps = TdHTMLAttributes<HTMLTableCellElement>;

export function DataTableCell({ className, ...props }: DataTableCellProps) {
  return <td className={cn('border-t border-slate-100 px-2.5 py-1.5 align-middle text-sm', className)} {...props} />;
}