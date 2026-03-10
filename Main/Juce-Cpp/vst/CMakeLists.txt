cmake_minimum_required(VERSION 3.16)
project(sls_vst_host LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Isolated VST host module to build in parallel with engine/.
# JUCE is shared from ../Juce.
add_subdirectory(../Juce JuceBuild-vst)

add_library(sls-vst-host STATIC
    src/VstHostStub.cpp
)

target_include_directories(sls-vst-host PUBLIC
    ${CMAKE_CURRENT_LIST_DIR}/include
)

target_compile_definitions(sls-vst-host PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
)

target_link_libraries(sls-vst-host PUBLIC
    juce::juce_audio_processors
    juce::juce_audio_plugin_client
    juce::juce_core
)
