import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Shell } from '../Shell.js';

describe('Shell — keyboard navigation order (row 49)', () => {
  it('Tab from the document reaches the skip link first, then the main landmark', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Shell>
          <p>screen content</p>
        </Shell>
      </MemoryRouter>,
    );

    await user.tab();
    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives every primary nav item a real, resolvable accessible name', () => {
    render(
      <MemoryRouter>
        <Shell>
          <p>screen content</p>
        </Shell>
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: /primary/i });
    const links = within(nav).getAllByRole('link');

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAccessibleName();
    }
  });
});
