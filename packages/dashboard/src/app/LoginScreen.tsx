import { useState, type ReactElement, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../api/client.js';
import { Button } from '../components/atoms/Button.js';
import { TextField } from '../components/atoms/TextField.js';

interface LoginResponse {
  readonly status: 'ok';
}

/**
 * The one unauthenticated screen (D2). `POST /login` MUST NOT trip the
 * session-expiry event: a wrong password here means "wrong password", not
 * "your session died" — it happens before any session exists (design Part 1
 * §3), so it opts out via `suppressSessionExpiry`.
 */
export function LoginScreen(): ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    void apiFetch<LoginResponse>('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
      suppressSessionExpiry: true,
    })
      .then(() => {
        void navigate('/', { replace: true });
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? 'Invalid password.' : 'Something went wrong.');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit}>
        <TextField
          id="password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
        />
        <Button type="submit" disabled={submitting}>
          Sign in
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
