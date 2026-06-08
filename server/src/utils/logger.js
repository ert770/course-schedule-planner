import winston from 'winston';

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'magenta'
  }
};

winston.addColors(customLevels.colors);

const customFormat = winston.format.printf(({ level, message, label }) => {
  const lbl = label ? `[${label}] ` : '';
  // Winston adds ANSI escape codes for colors, so level will have color codes.
  // We want the output to look like [INFO] [AgentCore] message
  return `[${level.toUpperCase()}] ${lbl}${message}`;
});

export const logger = winston.createLogger({
  levels: customLevels.levels,
  level: 'trace',
  format: winston.format.combine(
    winston.format.colorize(),
    customFormat
  ),
  transports: [
    new winston.transports.Console()
  ],
});
