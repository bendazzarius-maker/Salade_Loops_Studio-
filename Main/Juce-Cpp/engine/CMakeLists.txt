cmake_minimum_required(VERSION 3.16)
project(sls_audio_engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(../Juce JuceBuild)

juce_add_console_app(sls-audio-engine
    PRODUCT_NAME "sls-audio-engine"
)

target_sources(sls-audio-engine PRIVATE
    src/main.cpp
)

target_compile_definitions(sls-audio-engine PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(sls-audio-engine PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_dsp
    juce::juce_events
    juce::juce_core
    juce::juce_data_structures
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)

set(SLS_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../native")

add_custom_command(TARGET sls-audio-engine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${SLS_NATIVE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:sls-audio-engine>"
        "${SLS_NATIVE_DIR}/$<TARGET_FILE_NAME:sls-audio-engine>"
    COMMENT "Copying sls-audio-engine to Main/native"
    VERBATIM
)
