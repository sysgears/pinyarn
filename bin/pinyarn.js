#!/usr/bin/env node

const cp = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const { fstat } = require('fs');
const { runInNewContext } = require('vm');

const YARNRC = `.yarnrc.yml`;
const PINYARN = `.pinyarn.js`;
const PINYARN_JSON = `.pinyarn.json`;
const PACKAGE_JSON = `package.json`;
const BERRY_GIT_URL = `https://github.com/yarnpkg/berry.git`;

const args = process.argv;

if (args.includes('-h') || args.includes('--help')) {
  console.log(`Syntax: pinyarn [options] [yarn version]`);
  console.log();
  console.log(`If no arguments are provided pinyarn will determine yarn version used and pins it into '${PACKAGE_JSON}'`)
  console.log();
  console.log(`Supported yarn version formats:`);
  console.log(`    - exact version: 0.14.1 or 2.1.1 or ...`);
  console.log(`    - latest stable: 1 or classic - latest stable Yarn classic version; 2 or berry - latest stable Yarn 2 version`);
  console.log(`    - Yarn 2 pull request number: 1030 or 1031 or ..., the head commit at the PR will be pinned`);
  console.log(`    - Yarn 2 commit sha or branch name: 95af161 or master or ...`);
  console.log();
  console.log(`Supported options:`);
  console.log(`  -h --help prints this help`);
}

if (!fs.existsSync(PACKAGE_JSON)) {
  console.error(`'pinyarn' must be run from a directory with '${PACKAGE_JSON}'`);
  process.exit(1);
}

let yarnUrl;

let pinyarnJson;
if (fs.existsSync(PINYARN_JSON)) {
  try {
    pinyarnJson = JSON.parse(fs.readFileSync(PINYARN_JSON, 'utf8'));
  } catch (e) {}
}
if (!pinyarnJson) {
  pinyarnJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', PINYARN_JSON), 'utf8'));
  delete pinyarnJson.pluginUrls;
}
let newPinyarnJson = JSON.parse(JSON.stringify(pinyarnJson));
newPinyarnJson.pluginUrls = newPinyarnJson.pluginUrls || {};

let yarnrc = fs.existsSync(YARNRC) ? fs.readFileSync(YARNRC, 'utf-8') : `yarnPath: path\n`;
let newYarnrc = yarnrc;
let pinyarn = fs.existsSync(PINYARN) ? fs.readFileSync(PINYARN, 'utf-8') : '';
let newPinyarn = fs.readFileSync(path.join(__dirname, '..', PINYARN), 'utf-8');
const REST_HEADERS = {
  'User-Agent': `pinyarn/?`,
  'Authorization': `token ${newPinyarnJson.ghTokens[Math.floor(Math.random() * newPinyarnJson.ghTokens.length)].join('')}`
};

const downloadText = async (url, headers) => {
  return new Promise((resolve, reject) => {
    const urlParts = new URL(url);

    https.get({
      host: urlParts.host,
      path: urlParts.pathname + urlParts.search,
      headers
    }, res => {
      if (res.statusCode === 200) {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve(body);
        });
      } else {
        reject(new Error(`${res.statusCode} ${res.statusMessage} at ${url}`));
      }
    }).on('error', reject);
  });
}

const downloadJson = async (url, headers) => JSON.parse(await downloadText(url, REST_HEADERS));
const isUrlExists = async (url) => {
  return new Promise((resolve, reject) => {
    const urlParts = new URL(url);

    const req = https.request({
      method: 'HEAD',
      host: urlParts.host,
      path: urlParts.pathname + urlParts.search
    }, res => resolve(res.statusCode === 200));
    req.on('error', reject);
    req.end();
  });
};

const getUrlHash = url => crypto.createHash('sha256').update(url).digest('hex').substring(0, 8);
const getBerryUrl = version => `https://raw.githubusercontent.com/yarnpkg/berry/%40yarnpkg/cli/${version}/packages/yarnpkg-cli/bin/yarn.js`;
const getPluginUrl = (name, version) => `https://raw.githubusercontent.com/yarnpkg/berry/${version}/packages/plugin-${name}/bin/%40yarnpkg/plugin-${name}.js`;

const getClassicUrl = release => {
  for (const asset of release.assets) {
    if (/yarn-[0-9\.\-]+\.js$/.test(asset.browser_download_url)) {
      return asset.browser_download_url;
    }
  }
}

(async () => {
  try {
    let argVersion;
    if (args.length === 2) {
      const yarn = cp.spawnSync('yarn', ['--version'], { encoding: 'utf-8' });
      argVersion = yarn.stdout.trim();
      if (argVersion.includes('git.')) {
        argVersion = argVersion.substring(argVersion.lastIndexOf('.') + 1);
      }
    } else {
      argVersion = process.argv[2];
    }

    let yarnVersion;
    let pluginsVersion;
    let yarnDescription;
    let berryTags = new Map();
    let berryTagSha;
    if (argVersion === '1' || argVersion === 'classic') {
      const latestRelease = await downloadJson('https://api.github.com/repos/yarnpkg/yarn/releases/latest');
      yarnVersion = latestRelease.tag_name.substring(1);
      yarnUrl = getClassicUrl(latestRelease);
    } else if (argVersion.startsWith('0.') || argVersion.startsWith('1.')) {
      const release = await downloadJson(`https://api.github.com/repos/yarnpkg/yarn/releases/tags/v${argVersion}`);
      if (!release.message) {
        yarnVersion = release.tag_name.substring(1);
        yarnUrl = getClassicUrl(release);
      }
    } else if (argVersion === '2' || argVersion === 'berry' || argVersion.startsWith('2.')) {
      const gitRefs = await downloadText(`${BERRY_GIT_URL}/info/refs?service=git-upload-pack`, {'User-Agent': 'pinyarn/?'});
      for (const line of gitRefs.split('\n')) {
        const len = parseInt(line.substring(0, 4), 16);
        if (len === 0)
          continue;
        const payload = line.substring(4, 4 + len);
        const [sha, ref] = payload.split(' ');
        if (ref.startsWith(`refs/tags`) && !ref.endsWith('^{}'))
          continue;
        berryTags.set(ref.replace('^{}', ''), sha);
      }
      const sortedTags = Array.from(berryTags.keys()).sort();
      let foundTag;
      if (argVersion === '2' || argVersion === 'berry') {
        for (const tag of sortedTags.reverse()) {
          if (tag.startsWith(`refs/tags/@yarnpkg/cli/`)) {
            foundTag = tag;
            break;
          }
        }
      } else {
        for (const tag of sortedTags.slice(0).reverse()) {
          if (tag === `refs/tags/@yarnpkg/cli/${argVersion}`) {
            foundTag = tag;
            break;
          }
        }
      }
      if (foundTag) {
        berryTagSha = berryTags.get(foundTag);
        yarnVersion = foundTag.substring(foundTag.lastIndexOf('/') + 1);
        pluginsVersion = berryTagSha.substring(0, 7);
        yarnDescription = `${yarnVersion} ${berryTagSha.substring(0, 7)}`;
        yarnUrl = getBerryUrl(yarnVersion);
      }
    } else {
      let searchVersion = argVersion;
      if (/^[0-9]+$/.test(argVersion)) {
        try {
          const pr = await downloadJson(`https://api.github.com/repos/yarnpkg/berry/pulls/${argVersion}`);
          searchVersion = pr.head.sha;
        } catch (e) {}
      }
      let runs;
      let page = 0;
      do {
        runs = await downloadJson(`https://api.github.com/repos/yarnpkg/berry/actions/workflows/artifacts-workflow.yml/runs?per_page=100&page=${page}`);
        let foundRun;
        console.log(`Searching through GH action workflow runs page ${page}/${Math.ceil(runs.total_count / 100)}...`)
        for (const run of runs.workflow_runs) {
          if (run.head_sha.startsWith(searchVersion) ||
              run.head_branch.startsWith(searchVersion) ||
              run.head_commit.tree_id.startsWith(searchVersion)) {
            foundRun = run;
          }
          if (foundRun) {
            const artifacts = await downloadJson(foundRun.artifacts_url);
            let foundArtifact = null;
            for (const artifact of artifacts.artifacts) {
              if (artifact.name === 'bundle') {
                foundArtifact = artifact;
                break;
              }
            }
            if (foundArtifact) {
              yarnVersion = foundRun.head_sha.substring(0, 7);
              pluginsVersion = yarnVersion;
              yarnDescription = `${yarnVersion} in ${foundRun.head_branch} '${foundRun.head_commit.message}'`;
              yarnUrl = foundArtifact.archive_download_url;
              break;
            }
          }
        }
        if (foundRun)
          break;
        page++;
      } while (runs.workflow_runs.length === 100);
    }

    if (typeof yarnUrl === 'undefined') {
      console.error(`Yarn version ${argVersion} not found`);
      process.exit(1);
    } else {
      console.log(`Yarn binary ${yarnDescription} at ${yarnUrl}`);
    }

    newPinyarnJson.yarnUrl = yarnUrl;

    const PLUGIN_LIST = !fs.existsSync(YARNRC) ? [] : fs.readFileSync(YARNRC, 'utf-8')
      .split('\n')
      .filter(line => line.includes('.yarn/plugins/@yarnpkg/plugin-'))
      .map(line => line.replace(/^.*\.yarn\/plugins\/@yarnpkg\/plugin-(.*?)(?:-[0-9a-f]{8})?\.cjs$/, '$1'));

    for (const plugin of PLUGIN_LIST) {
      const pluginUrl = getPluginUrl(plugin, pluginsVersion);
      if (await isUrlExists(pluginUrl)) {
        newPinyarnJson.pluginUrls[plugin] = pluginUrl;
        newYarnrc = newYarnrc.replace(/(\.yarn\/plugins\/@yarnpkg\/plugin-)(.*?)(?:-[0-9a-f]{8})?(\.cjs)/, '$1' + plugin + '-' + getUrlHash(pluginUrl) + '$3');
        console.log(`${plugin} at ${pluginUrl}`)
      }
    }

    if (Object.keys(newPinyarnJson.pluginUrls).length === 0) {
      delete newPinyarnJson.pluginUrls;
    }

    if (!fs.existsSync(PINYARN)) {
      newYarnrc = newYarnrc.replace(/(yarnPath:[\s^\n]*)([^\n]*)\n?/, `$1.pinyarn\n`);
    }

    if (newYarnrc !== yarnrc) {
      fs.writeFileSync(YARNRC, newYarnrc);
    }

    if (newPinyarn !== pinyarn) {
      fs.writeFileSync(PINYARN, newPinyarn);
    }

    if (JSON.stringify(newPinyarnJson) !== JSON.stringify(pinyarnJson)) {
      fs.writeFileSync(PINYARN_JSON, JSON.stringify(newPinyarnJson, null, 2));
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
