'use client';
import { Button } from '@repo/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/card';
import { ArrowLeft, Frown, Home } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

const NotFoundPage = () => {
  return (
    <div className='bg-background flex min-h-screen items-center justify-center p-4 w-full'>
      <Card className='w-full max-w-md text-center'>
        <CardHeader>
          <CardTitle className='flex items-center justify-center text-3xl'>
            <Frown className='text-primary mr-3 h-12 w-12' />
            404 - Page Not Found
          </CardTitle>
          <CardDescription className='text-base'>
            Oops! The page you&apos;re looking for doesn&apos;t exist.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='border-primary/20 bg-muted/10 rounded-lg border border-dashed p-6'>
            <p className='text-muted-foreground'>
              The requested URL might have been removed, renamed, or temporarily unavailable.
            </p>
          </div>
          <div className='flex flex-col space-y-4'>
            <Button asChild className='w-full'>
              <Link href='/'>
                <Home className='mr-2 h-4 w-4' />
                Return to Home
              </Link>
            </Button>
            <Button variant='outline' className='w-full' onClick={() => window.history.back()}>
              <ArrowLeft className='mr-2 h-4 w-4' />
              Go Back
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotFoundPage;
