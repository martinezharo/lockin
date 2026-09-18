// Prune merged PR branches without touching ongoing or independently updated work.
// Run by GitHub Actions on a merge or a push to main. No third-party packages.
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  throw new Error('A valid GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status} on ${path}`);
  return response.status === 204 ? null : response.json();
}

async function allPulls(state) {
  const result = [];
  for (let page = 1; ; page++) {
    const batch = await api(`pulls?state=${state}&per_page=100&page=${page}`);
    result.push(...batch);
    if (batch.length < 100) return result;
  }
}

const [repository, openPulls, closedPulls] = await Promise.all([
  api(''), allPulls('open'), allPulls('closed')
]);
const defaultBranch = repository.default_branch;
const openHeads = new Set(openPulls
  .filter((pr) => pr.head.repo?.full_name === repo)
  .map((pr) => pr.head.ref));
let removed = 0;

for (const pr of closedPulls) {
  // GitHub may still report a PR's head after its branch has been deleted.
  if (!pr.merged_at || pr.base.ref !== defaultBranch ||
      pr.head.repo?.full_name !== repo || !pr.head.ref ||
      pr.head.ref === defaultBranch || openHeads.has(pr.head.ref)) continue;

  const branch = pr.head.ref;
  const encoded = branch.split('/').map(encodeURIComponent).join('/');
  const current = await api(`branches/${encoded}`);
  if (!current || current.protected || current.commit.sha !== pr.head.sha) continue;

  // Recheck before deletion; never remove a branch someone has since advanced.
  const latest = await api(`git/ref/heads/${encoded}`);
  if (!latest || latest.object.sha !== pr.head.sha) continue;
  await api(`git/refs/heads/${encoded}`, { method: 'DELETE' });
  console.log(`🧹 Deleted merged PR #${pr.number} branch ${branch}`);
  removed++;
}
console.log(`🐭 Branch cleanup complete: ${removed} merged branch(es) removed.`);
