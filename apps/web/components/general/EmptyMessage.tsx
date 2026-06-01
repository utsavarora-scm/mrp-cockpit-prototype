import React from 'react';

interface EmptyMessageProps {
  message: string;
  description: string;
  cta?: React.ReactNode;
  icon?: React.ReactNode;
}

const EmptyMessage = ({
  message = 'No Data Found',
  description = 'Check back later for new data.',
  icon,
  cta,
}: EmptyMessageProps) => {
  return (
    <div className='flex h-[200px] flex-col items-center justify-center gap-2 text-center'>
      {icon && icon}
      <p className='text-muted-foreground text-lg font-semibold'>{message}</p>
      <p className={`text-muted-foreground text-sm ${cta ? 'mb-2' : ''}`}>{description}</p>
      {cta && cta}
    </div>
  );
};

export default EmptyMessage;
