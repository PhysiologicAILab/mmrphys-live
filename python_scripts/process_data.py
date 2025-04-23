import json
import numpy as np
import matplotlib.pyplot as plt
from scipy import signal
from datetime import datetime
import os
import argparse


def load_data(file_path):
    """Load vital signs data from JSON file."""
    with open(file_path, 'r') as file:
        data = json.load(file)
    return data


def calculate_actual_sampling_rate(data):
    """Calculate the actual sampling rate from metadata."""
    try:
        # Get start and end times from metadata
        start_time = datetime.fromisoformat(
            data['metadata']['startTime'].replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(
            data['metadata']['endTime'].replace('Z', '+00:00'))

        # Calculate duration in seconds
        duration = (end_time - start_time).total_seconds()

        # Get number of samples
        num_samples = len(data['signals']['bvp']['raw'])

        # Calculate actual sampling rate
        actual_fs = num_samples / \
            duration if duration > 0 else data['metadata'].get(
                'samplingRate', 30)

        print(f"Calculated actual sampling rate: {actual_fs:.2f} Hz")
        print(f"Duration: {duration:.2f}s, Samples: {num_samples}")

        # Return the actual sampling rate, but use at least 10 Hz as minimum
        return max(actual_fs, 10)
    except Exception as e:
        print(f"Error calculating actual sampling rate: {e}")
        # Fall back to metadata sampling rate or default
        return data['metadata'].get('samplingRate', 30)


def apply_butterworth_bandpass(signal_data, fs, lowcut, highcut, order=4):
    """Apply Butterworth bandpass filter to the signal."""
    nyquist = 0.5 * fs
    low = lowcut / nyquist
    high = highcut / nyquist
    b, a = signal.butter(order, [low, high], btype='band')
    return signal.filtfilt(b, a, signal_data)


def find_dominant_frequency(fft_result, fs, min_freq, max_freq):
    """Find the dominant frequency in the specified range with harmonic detection."""
    # Calculate frequency resolution
    n = len(fft_result)
    freq_resolution = fs / n

    # Find indices corresponding to the frequency range
    min_idx = max(1, int(min_freq / freq_resolution))
    max_idx = min(int(max_freq / freq_resolution), n // 2)

    # Extract power spectrum in the frequency range
    power_spectrum = np.abs(fft_result[min_idx:max_idx])**2

    # If no valid data, return 0
    if len(power_spectrum) == 0:
        return 0

    # Create an array of all frequencies in our range
    frequencies = np.arange(min_idx, max_idx) * freq_resolution

    # Find all significant peaks in the power spectrum
    # A peak must be at least 20% of the maximum power in the range
    threshold = 0.2 * np.max(power_spectrum)
    peaks = []

    for i in range(1, len(power_spectrum) - 1):
        if (power_spectrum[i] > power_spectrum[i-1] and
            power_spectrum[i] > power_spectrum[i+1] and
                power_spectrum[i] > threshold):
            peaks.append({
                'idx': i + min_idx,
                'freq': frequencies[i],
                'power': power_spectrum[i]
            })

    # Sort peaks by power
    peaks.sort(key=lambda x: x['power'], reverse=True)

    if not peaks:
        # No peaks found, use the maximum power approach as fallback
        peak_idx = np.argmax(power_spectrum) + min_idx
        return peak_idx * freq_resolution

    dominant_peak = peaks[0]

    # Check if the most powerful peak might be a harmonic
    if len(peaks) > 1:
        # Look at other strong peaks
        for peak in peaks[1:]:
            # Check if this peak could be the fundamental frequency of the dominant peak
            ratio = dominant_peak['freq'] / peak['freq']

            # If the dominant frequency is approximately double of another peak
            if 1.9 < ratio < 2.1 and peak['power'] > 0.3 * dominant_peak['power']:
                print(
                    f"Detected harmonic: {dominant_peak['freq']:.2f}Hz is likely 2x of {peak['freq']:.2f}Hz")
                # Return the lower frequency (fundamental)
                return peak['freq']

    # If no harmonic relationship found, return the dominant frequency
    return dominant_peak['freq']


def calculate_heart_rate(signal_data, fs):
    """Calculate heart rate from BVP signal using FFT."""
    # Apply window to reduce spectral leakage
    windowed = signal.windows.hamming(len(signal_data)) * signal_data

    # Compute FFT
    fft_result = np.fft.fft(windowed)

    # Heart rate frequency range: 0.6-3.3 Hz (36-198 BPM)
    dominant_freq = find_dominant_frequency(fft_result, fs, 0.6, 3.3)

    # Convert frequency to BPM
    return dominant_freq * 60


def calculate_respiratory_rate(signal_data, fs):
    """Calculate respiratory rate from respiratory signal using FFT."""
    # Apply window to reduce spectral leakage
    windowed = signal.windows.hamming(len(signal_data)) * signal_data

    # Compute FFT
    fft_result = np.fft.fft(windowed)

    # Respiratory rate frequency range: 0.1-0.54 Hz (6-32 breaths/minute)
    dominant_freq = find_dominant_frequency(fft_result, fs, 0.1, 0.54)

    # Convert frequency to breaths per minute
    return dominant_freq * 60


def remove_dc(signal_data):
    """Remove DC component from the signal."""
    return signal_data - np.mean(signal_data)


def plot_signals(data, bvp_filtered, resp_filtered, hr, rr, actual_fs, file_path="data/sample_data.json"):
    """Plot raw and filtered signals with computed heart and respiratory rates."""
    sampling_rate = data['metadata']['samplingRate']  # Nominal sampling rate
    samples = len(data['signals']['bvp']['raw'])

    start_time = datetime.fromisoformat(
        data['metadata']['startTime'].replace('Z', '+00:00'))
    # end_time = datetime.fromisoformat(
    #     data['metadata']['endTime'].replace('Z', '+00:00'))
    # duration = (end_time - start_time).total_seconds()
    duration = samples / actual_fs

    # Create time arrays

    time = np.linspace(0, duration, samples)

    # Create plot figure
    plt.figure(figsize=(15, 10))

    # Plot BVP signals
    plt.subplot(2, 1, 1)
    plt.plot(time, data['signals']['bvp']['raw'],
             'b-', alpha=0.5, label='Raw BVP')
    plt.plot(time, bvp_filtered, 'r-', label='Filtered BVP')
    plt.title(f'Blood Volume Pulse (BVP) - Computed HR: {hr:.1f} BPM')
    plt.xlabel('Time (s)')
    plt.ylabel('Amplitude')
    plt.grid(True)
    plt.legend()

    # Add metadata annotation with actual sampling rate
    plt.annotate(f'Start Time: {start_time.strftime("%Y-%m-%d %H:%M:%S")}\n'
                 f'Duration: {duration:.2f} s\n'
                 f'Nominal Sampling Rate: {sampling_rate} Hz\n'
                 f'Actual Sampling Rate: {actual_fs:.2f} Hz\n'
                 f'Samples: {samples}',
                 xy=(0.02, 0.02), xycoords='axes fraction',
                 bbox=dict(boxstyle="round,pad=0.5", fc="white", alpha=0.8))

    # Plot Respiratory signals
    plt.subplot(2, 1, 2)
    plt.plot(time, data['signals']['resp']['raw'],
             'b-', alpha=0.5, label='Raw Resp')
    plt.plot(time, resp_filtered, 'r-', label='Filtered Resp')
    plt.title(f'Respiratory Signal - Computed RR: {rr:.1f} breaths/min')
    plt.xlabel('Time (s)')
    plt.ylabel('Amplitude')
    plt.grid(True)
    plt.legend()

    # Adjust layout and save plot
    plt.tight_layout()
    output_dir = os.path.dirname(file_path)
    output_file = os.path.join(output_dir, 'vital_signs_analysis.png')
    plt.savefig(output_file)
    plt.show()

    print(f"Analysis complete. Plot saved to {output_file}")
    print(f"Computed Heart Rate: {hr:.1f} BPM")
    print(f"Computed Respiratory Rate: {rr:.1f} breaths/min")


def plot_frequency_spectrum(signal_data, fs, title, y_label, min_freq=0, max_freq=None, file_path="data/sample_data.json"):
    """Plot the frequency spectrum of a signal with x-axis in BPM or breaths/min."""
    # Apply window to reduce spectral leakage
    windowed = signal.windows.hamming(len(signal_data)) * signal_data

    # Compute FFT
    fft_result = np.fft.fft(windowed)

    # Compute frequency array
    n = len(fft_result)
    freq = np.fft.fftfreq(n, 1/fs)

    # Convert frequency to rate (BPM or breaths/min)
    rate = freq * 60

    # Plot only the positive frequency components up to max_freq
    positive_mask = freq > 0
    if max_freq:
        positive_mask = (freq > 0) & (freq <= max_freq)

    plt.figure(figsize=(10, 6))
    plt.plot(rate[positive_mask], np.abs(fft_result)[positive_mask])

    # Set appropriate title and labels based on signal type
    if title == 'BVP':
        plt.title(f'Heart Rate Spectrum - {title} (Actual FS: {fs:.2f} Hz)')
        plt.xlabel('Heart Rate (BPM)')
    elif title == 'Respiratory':
        plt.title(
            f'Respiratory Rate Spectrum - {title} (Actual FS: {fs:.2f} Hz)')
        plt.xlabel('Respiratory Rate (breaths/min)')
    else:
        plt.title(f'Frequency Spectrum - {title}')
        plt.xlabel('Rate (per minute)')

    plt.ylabel(y_label)
    plt.grid(True)

    # Mark the min and max frequency search ranges (converted to rate)
    if title == 'BVP':
        plt.axvline(x=0.6 * 60, color='g', linestyle='--',
                    label='Min HR (36 BPM)')
        plt.axvline(x=3.3 * 60, color='r', linestyle='--',
                    label='Max HR (198 BPM)')
    elif title == 'Respiratory':
        plt.axvline(x=0.1 * 60, color='g', linestyle='--',
                    label='Min RR (6 breaths/min)')
        plt.axvline(x=0.54 * 60, color='r', linestyle='--',
                    label='Max RR (32 breaths/min)')

    plt.legend()

    # Save plot
    output_dir = os.path.dirname(file_path)
    output_file = os.path.join(
        output_dir, f'{title.lower()}_frequency_spectrum.png')
    plt.savefig(output_file)


def main(file_path, sampling_rate_override=None):
    # Load the JSON data
    data = load_data(file_path)

    # Calculate actual sampling rate from metadata
    actual_sampling_rate = calculate_actual_sampling_rate(data)

    # Use override if provided, otherwise use calculated actual rate
    sampling_rate = sampling_rate_override if sampling_rate_override else actual_sampling_rate

    # Extract signals and metadata
    bvp_raw = np.array(data['signals']['bvp']['raw'])
    resp_raw = np.array(data['signals']['resp']['raw'])

    # Remove DC component
    bvp_dc_removed = remove_dc(bvp_raw)
    resp_dc_removed = remove_dc(resp_raw)

    # Apply Butterworth bandpass filter with actual sampling rate
    # Heart rate: 0.6-3.3 Hz (36-198 BPM)
    bvp_filtered = apply_butterworth_bandpass(
        bvp_dc_removed, sampling_rate, 0.6, 3.3)

    # Respiratory rate: 0.1-0.54 Hz (6-32 breaths/minute)
    resp_filtered = apply_butterworth_bandpass(
        resp_dc_removed, sampling_rate, 0.1, 0.54)

    # Calculate heart rate and respiratory rate using FFT with actual sampling rate
    hr = calculate_heart_rate(bvp_filtered, sampling_rate)
    rr = calculate_respiratory_rate(resp_filtered, sampling_rate)

    # Plot frequency spectrums with actual sampling rate
    plot_frequency_spectrum(bvp_filtered, sampling_rate,
                            'BVP', 'Magnitude', max_freq=5, file_path=file_path)
    plot_frequency_spectrum(resp_filtered, sampling_rate,
                            'Respiratory', 'Magnitude', max_freq=1, file_path=file_path)

    # Plot signals and results
    plot_signals(data, bvp_filtered, resp_filtered,
                 hr, rr, sampling_rate, file_path=file_path)

    # Compare with values in the JSON file
    # Calculate median heart rate and respiratory rate from the JSON data
    hr_values = [point['value'] for point in data['rates']['heart']]
    rr_values = [point['value'] for point in data['rates']['respiratory']]

    median_hr = np.median(hr_values)
    median_rr = np.median(rr_values)

    print(f"\nComparison with recorded values:")
    print(
        f"Computed HR: {hr:.1f} BPM vs Median recorded HR: {median_hr:.1f} BPM")
    print(
        f"Computed RR: {rr:.1f} breaths/min vs Median recorded RR: {median_rr:.1f} breaths/min")

    print(
        f"\nNominal sampling rate: {data['metadata'].get('samplingRate', 'unknown')} Hz")
    print(f"Actual calculated sampling rate: {actual_sampling_rate:.2f} Hz")
    if sampling_rate_override:
        print(
            f"Using manual override sampling rate: {sampling_rate_override} Hz")


if __name__ == "__main__":
    # Set up argument parser
    parser = argparse.ArgumentParser(
        description='Process vital signs data from a JSON file')
    parser.add_argument('file_path', type=str,
                        help='Path to the JSON file containing vital signs data')
    parser.add_argument('--sampling_rate', type=int,
                        help='Override sampling rate in Hz (optional)')

    # Parse arguments
    args = parser.parse_args()

    # Run main function with the provided file path
    main(args.file_path, args.sampling_rate)
