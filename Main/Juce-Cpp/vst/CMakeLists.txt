cmake_minimum_required(VERSION 3.16)
project(sls_vst_host VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Isolated VST host module to build in parallel with engine/.
# JUCE is shared from ../Juce.
add_subdirectory(../Juce JuceBuild-vst)

juce_add_console_app(sls-vst-host
    PRODUCT_NAME "sls-vst-host"
)

target_sources(sls-vst-host PRIVATE
    src/main.cpp
    src/VstHostStub.cpp
)

target_include_directories(sls-vst-host PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/include
)

target_compile_definitions(sls-vst-host PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    JUCE_PLUGINHOST_LV2=0
    JUCE_PLUGINHOST_VST3=1
)

target_link_libraries(sls-vst-host PRIVATE
    juce::juce_audio_processors
    juce::juce_audio_plugin_client
    juce::juce_core
    juce::juce_data_structures
    juce::juce_events
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)

# Copy built binary to Main/native (Electron can spawn it)
set(SLS_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../native")
add_custom_command(TARGET sls-vst-host POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${SLS_NATIVE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:sls-vst-host>"
        "${SLS_NATIVE_DIR}/$<TARGET_FILE_NAME:sls-vst-host>"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:sls-vst-host>"
        "${SLS_NATIVE_DIR}/sls-vst-host$<$<PLATFORM_ID:Windows>:.exe>"
    COMMENT "Copying sls-vst-host to Main/native"
    VERBATIM
)

if(UNIX AND NOT APPLE)
    add_custom_command(TARGET sls-vst-host POST_BUILD
        COMMAND /bin/chmod +x "${SLS_NATIVE_DIR}/sls-vst-host"
        COMMENT "Marking Main/native/sls-vst-host as executable"
        VERBATIM
    )
endif()
