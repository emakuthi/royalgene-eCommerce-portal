import * as React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  value?: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}

export default function StatCard({ title, value, subtitle, icon, loading, className, ...props }: StatCardProps) {
  return (
    <Paper elevation={2} className={className} sx={{ p: 2 }} {...props}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {icon && <Box sx={{ mr: 1 }}>{icon}</Box>}
        <Box>
          <Typography variant="caption" color="text.secondary">{title}</Typography>
          <Typography variant="h6">{loading ? '-' : value}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
      </Box>
    </Paper>
  );
}
