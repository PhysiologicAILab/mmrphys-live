// src/services/configService.ts
import { ApplicationPaths, Paths } from '@/utils/paths';

export type ModelConfig = {
    FRAME_NUM: number;
    TASKS: string[];
    FS: number;
    sampling_rate: number;
    input_size: number[];
    output_names: string[];
    model_info: {
        name: string;
        version: string;
        description: string;
    };
    model_path: string;
    signal_parameters: {
        bvp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
        resp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
    };
};

class ConfigService {
    private static instance: ConfigService;
    private config: ModelConfig | null = null;
    private configPromise: Promise<ModelConfig> | null = null;
    private configLoadAttempted: boolean = false;

    private constructor() { }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public async getConfig(): Promise<ModelConfig> {
        if (this.config) {
            return this.config;
        }

        if (!this.configPromise) {
            this.configPromise = this.loadConfig();
        }

        try {
            const config = await this.configPromise;
            return config;
        } catch (error) {
            console.error('[ConfigService] Failed to load config:', error);
            throw new Error('Configuration failed to load: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    public async getFrameWidth(): Promise<number> {
        try {
            const config = await this.getConfig();

            // Check if input_size exists and has the expected structure
            if (config.input_size && Array.isArray(config.input_size) && config.input_size.length >= 5) {
                // Width is the last dimension in [B,C,T,H,W]
                const width = config.input_size[4];
                console.log(`[ConfigService] Found frame width in config: ${width}`);
                return width;
            }

            console.warn('[ConfigService] Could not find frame width in config, using default of 72');
            return 72; // Default if not found
        } catch (error) {
            console.warn('[ConfigService] Error getting frame width, using default:', error);
            return 72;
        }
    }

    public async getFrameHeight(): Promise<number> {
        try {
            const config = await this.getConfig();

            // Check if input_size exists and has the expected structure
            if (config.input_size && Array.isArray(config.input_size) && config.input_size.length >= 5) {
                // Height is the 2nd last dimension in [B,C,T,H,W]
                const height = config.input_size[3];
                console.log(`[ConfigService] Found frame height in config: ${height}`);
                return height;
            }

            console.warn('[ConfigService] Could not find frame height in config, using default of 72');
            return 72; // Default if not found
        } catch (error) {
            console.warn('[ConfigService] Error getting frame height, using default:', error);
            return 72;
        }
    }

    public async getSequenceLength(): Promise<number> {
        try {
            const config = await this.getConfig();
            if (config.FRAME_NUM) {
                console.log(`[ConfigService] Found sequence length in config: ${config.FRAME_NUM}`);
                return config.FRAME_NUM;
            }

            // Check if input_size specifies a sequence length
            if (config.input_size && Array.isArray(config.input_size) && config.input_size.length >= 5) {
                const sequenceLength = config.input_size[2];
                console.log(`[ConfigService] Found sequence length in input_size: ${sequenceLength}`);
                return sequenceLength;
            }

            console.warn('[ConfigService] Could not find sequence length in config, using default of 181');
            return 181; // Default to 181 frames if not specified
        } catch (error) {
            console.warn('[ConfigService] Error getting sequence length, using default:', error);
            return 181;
        }
    }


    private async loadConfig(): Promise<ModelConfig> {
        try {
            const configPath = ApplicationPaths.rphysConfig();
            console.log(`[ConfigService] Loading model configuration from ${configPath}`);

            const response = await fetch(configPath, {
                cache: 'force-cache',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
            }

            const configData = await response.json();
            console.log('[ConfigService] Raw config data:', configData);

            // Perform additional validation
            if (!configData || typeof configData !== 'object') {
                throw new Error('Config is null or not an object');
            }

            // Verify expected structure
            if (!Array.isArray(configData.input_size)) {
                throw new Error('Config is missing input_size array');
            }

            this.config = configData as ModelConfig;
            this.configLoadAttempted = true;

            console.log('[ConfigService] Model configuration loaded successfully');
            console.log('[ConfigService] Input dimensions:', configData.input_size);

            return this.config;
        } catch (error) {
            this.configLoadAttempted = true;
            console.error('[ConfigService] Error loading config:', error);
            throw error;
        }
    }
}

export const configService = ConfigService.getInstance();
export default configService;