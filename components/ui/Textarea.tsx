import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[120px] w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 hover:border-[#c8d4c3] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#eef1ec] disabled:text-slate-500 resize-y',
        className,
      )}
      {...props}
    />
  );
});

export default Textarea;