import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { VibePlanClient } from '../src/vibe-client';

const baseUrl = 'http://test-api.vibeplan.com';
const apiKey = 'test-api-key';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('VibePlanClient', () => {
  const client = new VibePlanClient({ baseUrl, apiKey });

  it('lists projects successfully', async () => {
    const mockProjects = [{ id: '1', name: 'Project 1' }];
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return HttpResponse.json(mockProjects);
      })
    );

    const projects = await client.listProjects();
    expect(projects).toEqual(mockProjects);
  });

  it('gets a single project with analysis', async () => {
    const mockProject = { id: '1', name: 'Project 1', analysis: {} };
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('id') === '1') {
          return HttpResponse.json(mockProject);
        }
        return new HttpResponse(null, { status: 404 });
      })
    );

    const project = await client.getProject('1');
    expect(project).toEqual(mockProject);
  });

  it('handles API errors correctly', async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return new HttpResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      })
    );

    await expect(client.listProjects()).rejects.toThrow('Unauthorized');
  });

  it('handles network errors or malformed JSON', async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return new HttpResponse('Not JSON', { status: 500 });
      })
    );

    await expect(client.listProjects()).rejects.toThrow('Internal Server Error');
  });

  it('submits a task correctly', async () => {
    const mockSession = { sessionId: 'session-123' };
    server.use(
      http.post(`${baseUrl}/api/tasks/submit`, async ({ request }) => {
        const body = await request.json() as any;
        expect(body.title).toBe('Test Task');
        return HttpResponse.json(mockSession);
      })
    );

    const result = await client.submitTask({
      title: 'Test Task',
      prompt: 'Test Prompt',
      projectId: '1',
      taskType: 'features'
    });

    expect(result).toEqual(mockSession);
  });

  it('updates a user story status', async () => {
    server.use(
      http.put(`${baseUrl}/api/crud/user-stories`, async ({ request }) => {
        const body = await request.json() as any;
        expect(body.id).toBe('story-1');
        expect(body.status).toBe('completed');
        return HttpResponse.json({ success: true });
      })
    );

    const result = await client.updateUserStory('story-1', { status: 'completed' });
    expect(result).toEqual({ success: true });
  });
});
