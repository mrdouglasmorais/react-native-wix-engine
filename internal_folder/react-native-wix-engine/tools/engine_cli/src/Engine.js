const { ArgumentParser } = require('argparse');
const { AsyncPackagerRunner } = require('./runners/AsyncPackagerRunner');
const { IosRunner } = require('./runners/IosRunner');
const { AndroidRunner } = require('./runners/AndroidRunner');
const { Logger } = require('./utils/Logger');
const { PackagerWatcher } = require('./runners/PackagerWatcher');
const { RNCLIConfigValidator } = require('./runners/RNCLIConfigValidator');
const { GenerateConfiguration } = require('./GenerateConfiguration');
const BuildType = require('../../native_builds/BuildType');
const { simulator } = require('../../native_builds/BuildPlatforms');

function parseArgs() {
  const parser = new ArgumentParser();

  parser.addArgument(['-i', '--run-ios'], {
    help: "Uninstall, install, and run the app on iOS simulators; unless '--ios-devices' is used.",
    action: 'storeTrue',
  });

  parser.addArgument(['-a', '--run-android'], {
    help: 'Uninstall, install, and run the app on connected Android devices.',
    action: 'storeTrue',
  });

  parser.addArgument(['-U', '--disable-uninstall'], {
    help: 'Prevent uninstallation of the app before installation.',
    action: 'storeTrue',
  });

  parser.addArgument(['-n', '--native-build-type'], {
    defaultValue: BuildType.dev,
    choices: Object.values(BuildType),
    help: 'Specify the native build type to install.',
  });

  parser.addArgument(['-p', '--custom-config-json'], {
    help: 'Path to a custom configuration JSON file (default: package.json in the current directory).',
  });

  parser.addArgument(['--ios-devices'], {
    help: "Comma-separated list of iOS devices (names as in 'xcrun simctl list devices -j').",
  });

  parser.addArgument(['--ios-udids'], {
    help: "Comma-separated list of iOS device UDIDs (as in 'xcrun simctl list devices -j').",
  });

  parser.addArgument(['-P', '--no-packager'], {
    help: "Don't start the Metro Bundler packager.",
    action: 'storeTrue',
  });

  parser.addArgument(['--reset-cache'], {
    help: 'Reset the Metro Bundler packager cache.',
    action: 'storeTrue',
  });

  parser.addArgument(['--packager-port'], {
    help: 'Port for the Metro Bundler.',
    defaultValue: '8081',
  });

  parser.addArgument(['--force-localhost'], {
    help: 'Always use 127.0.0.1 instead of detecting the IP address.',
    action: 'storeTrue',
  });

  parser.addArgument('ignored', { isPositional: true, nargs: '*' });
  return parser.parseArgs();
}

async function run(args) {
  let packagerProcess;
  try {
    const engineDir = `${__dirname}/../../..`;

    Logger.info('Validating React Native CLI configuration...');
    new RNCLIConfigValidator().run();

    Logger.info('Generating project configuration...');
    new GenerateConfiguration().run({
      root_path: `${engineDir}/../..`,
      package_json_path: args.custom_config_json || `${process.cwd()}/package.json`,
      watch: false,
      force_localhost: args.force_localhost,
    });

    const packagerWatcher = new PackagerWatcher(args.packager_port, args.no_packager);

    if (!(await packagerWatcher.validateDown())) {
      Logger.error(
        `A packager is already running on port ${args.packager_port}. ` +
          'Use the -P option to bypass starting a new packager or stop the existing one.'
      );
      process.exit(1);
    }

    packagerWatcher.startWatchingUntilUp();

    if (!args.no_packager) {
      Logger.info('Starting Metro Bundler...');
      packagerProcess = new AsyncPackagerRunner().run(engineDir, args.reset_cache, args.packager_port);
    }

    Logger.info('Running platform-specific tasks...');
    await Promise.all([
      (async () => {
        try {
          if (args.run_ios) {
            const iosRunner = new IosRunner(packagerWatcher, args.ios_devices, args.ios_udids);
            await iosRunner.run(engineDir, args.native_build_type, args.disable_uninstall, simulator);
          }
        } catch (error) {
          Logger.error('Error running iOS tasks:', error);
          throw error;
        }
      })(),
      (async () => {
        try {
          if (args.run_android) {
            const androidRunner = new AndroidRunner(packagerWatcher);
            await androidRunner.run(engineDir, args.native_build_type, args.disable_uninstall);
          }
        } catch (error) {
          Logger.error('Error running Android tasks:', error);
          throw error;
        }
      })(),
    ]);
  } catch (ex) {
    Logger.error('An error occurred:', ex);

    if (packagerProcess && typeof packagerProcess.kill === 'function') {
      try {
        Logger.info('Stopping the Metro Bundler process...');
        packagerProcess.kill();
      } catch (killError) {
        Logger.error('Failed to stop the Metro Bundler process:', killError);
      }
    } else {
      Logger.info('No Metro Bundler process to stop.');
    }

    process.exit(0);
  }
}

module.exports = { run, parseArgs };
