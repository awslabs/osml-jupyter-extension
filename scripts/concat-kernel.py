#!/usr/bin/env python3
"""
Concatenate numbered Python files into kernel-setup.py

This script takes all files matching the pattern src/kernel/[0-9][0-9]_*.py,
sorts them numerically, and concatenates them into src/kernel/kernel-setup.py
for injection into the Jupyter kernel.
"""

import os
import glob
from pathlib import Path

def concatenate_kernel_files():
    """Concatenate numbered Python files into kernel-setup.py"""
    src_dir = Path("src/kernel")
    output_file = src_dir / "kernel-setup.py"
    
    # Find all numbered Python files and sort them
    # Pattern matches: 01_file.py, 04a_file.py, 044_file.py, etc.
    numbered_files = sorted(glob.glob(str(src_dir / "[0-9][0-9]*_*.py")))
    
    if not numbered_files:
        print("No numbered Python files found in src/kernel/")
        print("Looking for files matching pattern: src/kernel/[0-9][0-9]*_*.py")
        return False
    
    print(f"Found {len(numbered_files)} numbered Python files:")
    for file_path in numbered_files:
        print(f"  - {os.path.basename(file_path)}")
    
    with open(output_file, 'w') as outfile:
        outfile.write('# Auto-generated kernel setup file\n')
        outfile.write('# Created by concatenating numbered Python modules\n')
        outfile.write('# DO NOT EDIT DIRECTLY - Edit source files instead\n\n')
        
        for file_path in numbered_files:
            filename = os.path.basename(file_path)
            outfile.write(f'\n# =============================================================================\n')
            outfile.write(f'# FROM: {filename}\n')
            outfile.write(f'# =============================================================================\n\n')
            
            with open(file_path, 'r') as infile:
                content = infile.read()
                
                # Filter out problematic lines that would conflict when concatenated
                lines = content.split('\n')
                filtered_lines = []
                for line in lines:
                    # Skip encoding and shebang lines after the first file
                    if (line.strip().startswith('# -*- coding:') or 
                        line.strip().startswith('#!/usr/bin/env')):
                        continue
                    filtered_lines.append(line)
                
                outfile.write('\n'.join(filtered_lines))
                outfile.write('\n\n')
        
        # Add the final completion marker
        outfile.write('"osml-jupyter-extension:JupyterImageLayer:KERNEL_SETUP_COMPLETE"\n')
    
    print(f"Successfully concatenated {len(numbered_files)} files into {output_file}")
    return True

if __name__ == "__main__":
    success = concatenate_kernel_files()
    exit(0 if success else 1)
