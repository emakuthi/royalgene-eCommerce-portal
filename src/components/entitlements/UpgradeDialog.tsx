'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function UpgradeDialog({
  open,
  onOpenChange,
  title = 'Upgrade your plan',
  description = 'This action isn’t available on your current plan. Upgrade to unlock it.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 pt-2">
          <Button className="flex-1" onClick={() => { window.location.href = '/settings?tab=billing'; }}>
            View plans
          </Button>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
