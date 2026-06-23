#!/bin/bash -e

#If the repository does have tags, then you're in a shallow clone (this is the default in CI systems like TravisCI or GitHub Actions).
#To fetch the history (including tags) from within a shallow clone, run
git config --global --add safe.directory /github/workspace
git fetch --prune --unshallow
GIT_DESCRIBE=$(git describe --tags)
case $GIT_DESCRIBE in
  *"-"*)
    BUILD_VERSION=$(echo "$GIT_DESCRIBE" | awk -F - '{print $1"-preview."$2}')
    HELM_VERSION=$(echo "$GIT_DESCRIBE" | awk -F'[.-]' '{print $1"."$2"."$3"-preview."$4}')
    ;;
  *)
    BUILD_VERSION=$GIT_DESCRIBE
    HELM_VERSION=$(echo "$GIT_DESCRIBE" | awk -F'[.-]' '{print $1"."$2"."$3$4}')
    ;;
esac
echo "BUILD_VER=$BUILD_VERSION" >> $GITHUB_ENV
echo "HELM_VER=$HELM_VERSION" >> $GITHUB_ENV