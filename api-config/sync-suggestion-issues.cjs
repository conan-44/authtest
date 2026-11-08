'use strict';

const LABELS = {
    bug: { color: 'd73a4a', description: 'Something is not working' },
    enhancement: { color: 'a2eeef', description: 'New feature or improvement' },
    'help wanted': { color: '008672', description: 'Extra attention is needed' },
    invalid: { color: 'e4e669', description: 'This does not seem right' }
};
const marker = id => `<!-- skvwaffle-suggestion:${encodeURIComponent(String(id))} -->`;

function createClients({ supabaseUrl, serviceKey, repository, githubToken, fetchImpl = fetch }) {
    if (!supabaseUrl || !serviceKey || !repository || !githubToken) {
        throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
    }
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
        throw new Error('Invalid Supabase URL or GitHub repository.');
    }
    const dbBase = `${url.origin}/rest/v1/`;
    const ghBase = `https://api.github.com/repos/${repository}/`;
    async function request(target, options) {
        const response = await fetchImpl(target, options);
        const text = await response.text();
        if (!response.ok) throw new Error(`${options.method || 'GET'} ${new URL(target).pathname} failed (${response.status}): ${text.slice(0, 1000)}`);
        return text ? JSON.parse(text) : null;
    }
    const db = (table, query = '', options = {}) => request(`${dbBase}${table}${query}`, {
        ...options,
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    const github = (path, options = {}) => request(`${ghBase}${path}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${githubToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    return { db, github };
}

async function databasePages(db, table, columns, order) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
        const query = new URLSearchParams({ select: columns, order, limit: '500', offset: String(offset) });
        const page = await db(table, `?${query}`);
        if (!Array.isArray(page)) throw new Error(`Invalid response from ${table}.`);
        rows.push(...page);
        if (page.length < 500) return rows;
    }
}

async function githubPages(github, path) {
    const rows = [];
    for (let page = 1; ; page += 1) {
        const result = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        if (!Array.isArray(result)) throw new Error(`Invalid GitHub response for ${path}.`);
        rows.push(...result);
        if (result.length < 100) return rows;
    }
}

function issueBody(suggestion) {
    const body = suggestion.body;
    const fences = body.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...fences.map(value => value.length + 1)));
    return `${marker(suggestion.id)}\nSubmitted through the website as **${suggestion.category}**.\n\n${fence}text\n${body}\n${fence}`;
}

async function sync({ db, github, log = console.log }) {
    const [suggestions, links, allIssues, labels] = await Promise.all([
        databasePages(db, 'blog_suggestions', 'id,title,body,category', 'id.asc'),
        databasePages(db, 'blog_suggestion_github_issues', 'suggestion_id,issue_number', 'suggestion_id.asc'),
        githubPages(github, 'issues?state=all'),
        githubPages(github, 'labels')
    ]);
    const labelNames = new Set(labels.map(label => label.name));
    for (const [name, settings] of Object.entries(LABELS)) {
        if (!labelNames.has(name)) await github('labels', { method: 'POST', body: JSON.stringify({ name, ...settings }) });
    }
    const issues = allIssues.filter(issue => !issue.pull_request);
    const byNumber = new Map(issues.map(issue => [issue.number, issue]));
    const byMarker = new Map();
    for (const issue of issues) {
        if (issue.user?.login !== 'github-actions[bot]' || typeof issue.body !== 'string') continue;
        const match = /^<!-- skvwaffle-suggestion:([^ ]+) -->\n/.exec(issue.body);
        if (!match) continue;
        if (byMarker.has(match[0].trim())) throw new Error('Duplicate suggestion markers found in GitHub issues; resolve them before syncing.');
        byMarker.set(match[0].trim(), issue);
    }
    const bySuggestion = new Map(links.map(link => [String(link.suggestion_id), link.issue_number]));
    for (const suggestion of suggestions) {
        if (suggestion.id == null || typeof suggestion.title !== 'string' || typeof suggestion.body !== 'string'
            || !Object.hasOwn(LABELS, suggestion.category)) throw new Error('Invalid suggestion data; sync stopped.');
        const id = String(suggestion.id);
        let issue;
        if (bySuggestion.has(id)) {
            issue = byNumber.get(bySuggestion.get(id));
            if (!issue) throw new Error(`Linked issue #${bySuggestion.get(id)} is unavailable; refusing to recreate or delete the suggestion.`);
        } else {
            issue = byMarker.get(marker(id));
            if (!issue) {
                issue = await github('issues', {
                    method: 'POST',
                    body: JSON.stringify({ title: suggestion.title, body: issueBody(suggestion), labels: [suggestion.category] })
                });
                if (!Number.isSafeInteger(issue?.number)) throw new Error('GitHub did not return a valid issue number.');
                log(`Created issue #${issue.number}.`);
            }
            await db('blog_suggestion_github_issues', '', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ suggestion_id: id, issue_number: issue.number })
            });
        }
        if (issue.state === 'closed' && issue.state_reason === 'completed') {
            const current = await github(`issues/${issue.number}`);
            if (current.state !== 'closed' || current.state_reason !== 'completed') continue;
            const query = new URLSearchParams({ id: `eq.${id}` });
            const deleted = await db('blog_suggestions', `?${query}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
            if (!Array.isArray(deleted) || deleted.length !== 1) {
                throw new Error(`Could not confirm deletion of the suggestion for issue #${issue.number}.`);
            }
            log(`Removed the suggestion for completed issue #${issue.number}.`);
        }
    }
}

if (require.main === module) {
    const clients = createClients({
        supabaseUrl: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        repository: process.env.GITHUB_REPOSITORY,
        githubToken: process.env.GITHUB_TOKEN
    });
    sync(clients).catch(error => {
        console.error('Suggestion sync failed:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { createClients, sync, marker, issueBody };
