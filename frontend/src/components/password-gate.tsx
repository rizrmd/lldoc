import { type FormEvent, useState } from 'react'
import { Lock } from 'lucide-react'

import { authenticate, isAuthenticated } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(isAuthenticated)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  if (authenticated) {
    return <>{children}</>
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (authenticate(value)) {
      setAuthenticated(true)
      setError(false)
    } else {
      setError(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18rem] bg-[radial-gradient(circle_at_top_left,rgba(244,143,48,0.23),transparent_42%),radial-gradient(circle_at_top_right,rgba(22,110,136,0.2),transparent_36%)]" />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm space-y-6 rounded-[2rem] border border-border/80 bg-card/90 p-8 shadow-soft"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl">LLDoc</h1>
          <p className="text-sm text-muted-foreground">Masukkan password untuk melanjutkan</p>
        </div>

        <div className="space-y-3">
          <Input
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(false)
            }}
            placeholder="Password"
            autoFocus
            className="text-center"
          />
          {error && (
            <p className="text-center text-sm text-destructive">Password salah</p>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg">
          Masuk
        </Button>
      </form>
    </div>
  )
}
