## pinyarn

[![npm version](https://badge.fury.io/js/pinyarn.svg)](https://badge.fury.io/js/pinyarn)
[![Twitter Follow](https://img.shields.io/twitter/follow/sysgears.svg?style=social)](https://twitter.com/sysgears)

`pinyarn` determines Yarn and Yarn plugins version used in the project and creates a
script that downloads exactly this version from official Yarn repository even when
global one changes.

## Usage

```bash
npx pinyarn
```

or if Yarn 2 is already used with the project

```bash
yarn dlx pinyarn
```

or

```bash
yarn dlx pinyarn 2
```

to use latest stable version 2

or

```bash
yarn dlx pinyarn master
```

to use latest version of Yarn 2 from master

or

```bash
yarn dlx pinyarn 1030
```

to use Yarn 2 version from latest commit to the Pull Request 1030

or

```bash
yarn dlx pinyarn 4cd0bba
```

to use Yarn 2 from commit sha 4cd0bba

# How it works

`pinyarn` computes URLs of Yarn and its plugins from where they can be downloaded and
generates two files:
  - `.pinyarn.js` - a script to download Yarn and plugins from these URLs
  - `.pinyarn.json` - configuration file with URLs and GitHub access tokens having public_repo permission

GitHub access tokens used only when you use unreleased Yarn 2 version from GitHub Actions build artifacts. You can generate your own list of GitHub access tokens, the
only requirement to them is that they have `public_repo` permission. Please
note that each token must be split into two or more pieces to prevent GitHub to autorevoke it. `.yarnrc.js` will pick the token from the list at random each time it will be needed to lower down chance of GitHub request throttling.

`pinyarn` modifies your `.yarnrc.yml` by setting `yarnPath` to point to `.pinyarn.js`. Each time Yarn is run it launches the script pointed to by `yarnPath`. `.pinyarn.js`
thus receives the control first and checks whether correct version of Yarn and plugins have been downloaded and if not downloads them, removes incorrect versions if any and
passes control to Yarn binary.

## License
Copyright © 2020 [SysGears (Cyprus) Limited]. This source code is licensed under the [MIT] license.

[MIT]: LICENSE
[SysGears (Cyprus) Limited]: http://sysgears.com
