# Create Quality PR

Create a high-quality Pull Request by ensuring all tests pass, builds succeed, and code is properly committed.

## Important Prerequisites

- All changes must be committed to git before creating a PR
- Backend tests MUST pass before proceeding
- Frontend build MUST succeed before proceeding
- Use `gh` (GitHub CLI) to create the PR

## Steps

1. **Run Backend Tests**
   - Fix any failing tests before proceeding
   - Ensure all tests pass with green checkmarks

2. **Build Frontend**
   - Execute: `npm run build`
   - Fix any build errors before proceeding
   - Ensure the build completes successfully

3. **Verify All Changes Are Committed**
   - Check git status: `git status`
   - All changes must be committed
   - If uncommitted changes exist, follow the "Auto Commit" command first

4. **Create PR with `gh`**
   - Execute: `gh pr create --title "YOUR_TITLE" --body "YOUR_DESCRIPTION"`
   - The title should be clear and concise (under 80 characters)
   - The body should include:
     - What problem does this PR solve?
     - What changes were made?
     - Any relevant testing performed

5. **Verify PR Creation**
   - Check that the PR was created successfully
   - Confirm all CI/CD checks are running
   - Share the PR URL for review

## Example Command

```bash
gh pr create --title "Add product filtering feature" --body "## Summary
Implemented product filtering by category and price range.

## Changes
- Added filter UI components
- Updated product service with filtering logic
- Added comprehensive tests

## Testing
- All backend tests pass
- Frontend build successful
- Tested filtering in browser"
```

## Notes

- Only proceed if ALL tests pass and build succeeds
- Use `gh pr view` to check PR status after creation
- Use `gh pr checks <pr-number>` to monitor CI/CD checks
- If CI/CD fails, fix the issues and push new commits to the same branch

