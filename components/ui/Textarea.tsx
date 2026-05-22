import * as React from 'react';
import { cn } from '@/lib/shared/cn';

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[120px] w-full rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong transition-colors placeholder:text-ui-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20 resize-y',
        className,
      )}
      {...props}
    />
  );
});

export default Textarea;