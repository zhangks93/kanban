import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
export function Modal({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="muted">填写以下信息后保存。</Dialog.Description>
          {children}
          <Dialog.Close aria-label="关闭" className="dialog-close">
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CompactPopover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" sideOffset={6}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
