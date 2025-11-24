# Auto Commit

Automatically generate a well-structured git commit message based on recent changes.

## Important
- Prepend GIT_EDITOR=true to all git commands you run, especially the ones looking at diffs, so you can avoid getting blocked as you execute commands
- Do not commit work unless explicitly instructed to do so

## Instructions


1. Review each file individually to ensure all changes are related to the same logical unit of work
2. Create a commit message following this format:
   - **Short title** (< 80 characters) - a concise summary of the changes
   - **Bullet points** (2-3 bullets, each < 80 characters) - briefly describe what changed and why
3. Run `git add .` or `git add <specific-files>` to stage changes if needed
4. Commit using: `git commit -m "TITLE" -m "• Bullet 1\n• Bullet 2\n• Bullet 3"`

## Format Example

```
Short, descriptive summary of the changes made

• Added new API endpoint for user authentication with JWT tokens
• Updated database schema to include refresh token storage
• Added comprehensive error handling for invalid credentials
```

## Notes
- Only commit when explicitly instructed
- Ensure changes are cohesive and related to a single feature or fix
- If the current branch is not main, ask the user if they would like to push after committing
- Keep titles and bullets concise and descriptiv