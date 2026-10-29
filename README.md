# Pushing to the github server
git master push

## TypeScript development

Edit `E:\KyawThu\Website\TOEIC-Q5\js\quiz.ts` to change the quiz logic.
The build generates `E:\KyawThu\Website\TOEIC-Q5\js\quiz.js` for the browser.
Keep both files in the repository. Run the build after each source change.

Install the development tools from the saved dependency versions:

```sh
npm --prefix "E:/KyawThu/Website/TOEIC-Q5" ci
```

Check the TypeScript source without generating files:

```sh
npm --prefix "E:/KyawThu/Website/TOEIC-Q5" run check
```

Build the browser file and run the existing quiz verification:

```sh
npm --prefix "E:/KyawThu/Website/TOEIC-Q5" run verify
```

To build without running verification:

```sh
npm --prefix "E:/KyawThu/Website/TOEIC-Q5" run build
```

Strict checking covers the quiz and its verification code.
The compiler also checks array access. It does not write output when errors exist.
The quiz still validates question data when it loads.
