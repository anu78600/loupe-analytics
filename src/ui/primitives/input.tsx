/**
 * Text input, textarea and label sharing one field style (control radius,
 * brass focus ring). Label is Radix's, so clicking it focuses the control.
 */
import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-control border border-border-strong bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 outline-none hover:border-border-accent focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, "h-9", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-ui font-medium text-fg-muted peer-disabled:opacity-50", className)}
      {...props}
    />
  );
}
