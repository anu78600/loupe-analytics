/**
 * Text input, textarea and label sharing one field style: the control radius,
 * a --border-strong edge that steps up to --border-hover under the pointer,
 * and the focus ring (2px of --focus with a 2px gap) on keyboard focus.
 * Disabled fields take the one disabled opacity. Label is Radix's, so
 * clicking it focuses the control.
 */
import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-control border border-border-strong bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-fast outline-none hover:border-border-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-disabled";

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
      className={cn("text-ui font-medium text-fg-muted peer-disabled:text-fg-disabled", className)}
      {...props}
    />
  );
}
