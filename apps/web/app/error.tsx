'use client';
import { Button } from '@repo/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/card';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const ErrorPage: React.FC<ErrorProps> = ({ error, reset }) => {
  return (
    <div className='bg-background flex min-h-screen items-center justify-center p-4 w-full'>
      <Card className='w-full max-w-md'>
        <CardHeader className='text-center'>
          <CardTitle className='mb-4 flex items-center justify-center'>
            <AlertTriangle className='text-destructive mr-2 h-12 w-12' />
            Error Occurred
          </CardTitle>
          <CardDescription>Something unexpected happened</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='bg-muted/50 rounded-lg p-4'>
            <p className='text-muted-foreground text-sm break-words'>{error.message || 'An unknown error occurred'}</p>
            {error.digest && <p className='text-muted-foreground mt-2 text-xs'>Error ID: {error.digest}</p>}
          </div>

          <div className='flex justify-center space-x-4'>
            <Button variant='outline' className='w-full' onClick={() => reset()}>
              <RefreshCw className='mr-2 h-4 w-4' />
              Try Again
            </Button>
            <Button variant='secondary' className='w-full' asChild>
              <Link href='/'>
                <Home className='mr-2 h-4 w-4' />
                Home
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ErrorPage;
